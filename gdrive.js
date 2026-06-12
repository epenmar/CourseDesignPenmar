// gdrive.js — Google Drive upload helper.
// Uses Google Identity Services (GIS) for OAuth with the drive.file scope,
// and the Drive v3 REST API for multipart uploads. All uploads target the
// course's existing Google Drive folder (driveFolder URL).

(function() {
  // Full drive scope: drive.file is too narrow — it can't see folders
  // created outside this app, which returns 404 when uploading to a
  // pre-existing course folder. Our OAuth screen is Internal (ASU only),
  // so the broader scope doesn't require Google verification.
  var SCOPE = 'https://www.googleapis.com/auth/drive';
  var accessToken = null;
  var tokenExpiresAt = 0;
  var pendingTokenResolvers = [];

  function folderIdFromUrl(url) {
    if (!url) return null;
    var m = String(url).match(/\/folders\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : null;
  }

  function gisReady() {
    return new Promise(function(resolve, reject) {
      if (window.google && window.google.accounts && window.google.accounts.oauth2) return resolve();
      var tries = 0;
      var iv = setInterval(function() {
        if (window.google && window.google.accounts && window.google.accounts.oauth2) {
          clearInterval(iv);
          resolve();
        } else if (++tries > 60) {
          clearInterval(iv);
          reject(new Error('Google Identity Services failed to load. Check your network or third-party cookie settings.'));
        }
      }, 100);
    });
  }

  function getAccessToken() {
    if (accessToken && Date.now() < tokenExpiresAt - 30000) {
      return Promise.resolve(accessToken);
    }
    return gisReady().then(function() {
      if (!window.GOOGLE_CLIENT_ID) {
        throw new Error('GOOGLE_CLIENT_ID not configured — see gdrive-config.js');
      }
      return new Promise(function(resolve, reject) {
        var client = google.accounts.oauth2.initTokenClient({
          client_id: window.GOOGLE_CLIENT_ID,
          scope: SCOPE,
          callback: function(resp) {
            if (resp && resp.error) return reject(new Error(resp.error_description || resp.error));
            accessToken = resp.access_token;
            tokenExpiresAt = Date.now() + (resp.expires_in || 3600) * 1000;
            resolve(accessToken);
          },
          error_callback: function(err) {
            reject(new Error((err && err.message) || 'Google sign-in was cancelled'));
          }
        });
        // Empty prompt = silent if possible, interactive only if consent needed
        client.requestAccessToken({ prompt: '' });
      });
    });
  }

  function _uploadToFolderId(folderId, name, blob, mimeType, onProgress, convertTo) {
    return getAccessToken().then(function(token) {
      var metadata = { name: name, parents: [folderId] };
      // convertTo lets the caller ask Drive to convert the upload to a
      // native Workspace type. e.g. uploading HTML with
      // convertTo='application/vnd.google-apps.document' lands a real
      // Google Doc that Drive can preview/edit, instead of an opaque
      // .doc blob that triggers "No preview available".
      if (convertTo) metadata.mimeType = convertTo;
      else if (mimeType) metadata.mimeType = mimeType;
      var form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', blob);
      return new Promise(function(resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,parents,webViewLink,webContentLink,driveId');
        xhr.setRequestHeader('Authorization', 'Bearer ' + token);
        if (onProgress && xhr.upload) {
          xhr.upload.addEventListener('progress', function(e) {
            if (e.lengthComputable) onProgress(e.loaded / e.total);
          });
        }
        xhr.onload = function() {
          if (xhr.status >= 200 && xhr.status < 300) {
            try { resolve(JSON.parse(xhr.responseText)); } catch (e) { reject(e); }
          } else {
            var detail = xhr.responseText;
            try {
              var j = JSON.parse(xhr.responseText);
              if (j && j.error && j.error.message) detail = j.error.message;
            } catch (e) {}
            reject(new Error('Drive upload ' + xhr.status + ': ' + detail));
          }
        };
        xhr.onerror = function() { reject(new Error('Drive upload network error')); };
        xhr.send(form);
      });
    });
  }

  function uploadBlob(folderUrl, name, blob, mimeType, onProgress, convertTo) {
    var folderId = folderIdFromUrl(folderUrl);
    if (!folderId) {
      return Promise.reject(new Error('No Drive folder configured for this course. Set the Google Drive Folder URL in Course Info.'));
    }
    return _uploadToFolderId(folderId, name, blob, mimeType, onProgress, convertTo);
  }

  // Find a child folder named `name` under `parentId`, or create it. Returns
  // the child folder's id. Drive folder names are not unique by default, so
  // we take the first match. supportsAllDrives + includeItemsFromAllDrives so
  // shared-drive course folders work the same as personal-drive ones.
  function findOrCreateFolder(parentFolderUrlOrId, name) {
    var parentId = /\/folders\//.test(String(parentFolderUrlOrId))
      ? folderIdFromUrl(parentFolderUrlOrId)
      : parentFolderUrlOrId;
    if (!parentId) return Promise.reject(new Error('No parent Drive folder.'));
    return getAccessToken().then(function(token) {
      var safeName = name.replace(/'/g, "\\'");
      var q = "'" + parentId + "' in parents and mimeType='application/vnd.google-apps.folder' and name='" + safeName + "' and trashed=false";
      var listUrl = 'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) + '&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true';
      return fetch(listUrl, { headers: { Authorization: 'Bearer ' + token } })
        .then(function(r) { return r.json(); })
        .then(function(res) {
          if (res && res.files && res.files.length > 0) return res.files[0].id;
          return fetch('https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] })
          }).then(function(r) { return r.json(); }).then(function(f) {
            if (!f || !f.id) throw new Error('Failed to create Drive folder: ' + JSON.stringify(f));
            return f.id;
          });
        });
    });
  }

  function uploadBlobToSubfolder(parentFolderUrl, subfolderName, name, blob, mimeType, onProgress) {
    return findOrCreateFolder(parentFolderUrl, subfolderName).then(function(subfolderId) {
      return _uploadToFolderId(subfolderId, name, blob, mimeType, onProgress);
    });
  }

  // Search the course folder + every immediate child folder for a file
  // matching `fileName`. Returns the matched file metadata (id, name,
  // parents, webViewLink) or null. Two API calls: one to enumerate child
  // folders, one to query for the file across all candidate parents.
  function findFileInCourseTree(courseFolderUrl, fileName) {
    var courseId = folderIdFromUrl(courseFolderUrl);
    if (!courseId || !fileName) return Promise.resolve(null);
    return getAccessToken().then(function(token) {
      var foldersQ = "'" + courseId + "' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false";
      var foldersUrl = 'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(foldersQ) +
        '&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=200';
      return fetch(foldersUrl, { headers: { Authorization: 'Bearer ' + token } })
        .then(function(r) { return r.json(); })
        .then(function(res) {
          var parentIds = [courseId].concat((res.files || []).map(function(f) { return f.id; }));
          var parentClause = parentIds.map(function(id) { return "'" + id + "' in parents"; }).join(' or ');
          var safeName = String(fileName).replace(/'/g, "\\'");
          var q = "(" + parentClause + ") and name='" + safeName + "' and trashed=false";
          var fileUrl = 'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) +
            '&fields=files(id,name,parents,webViewLink,webContentLink)&supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=10';
          return fetch(fileUrl, { headers: { Authorization: 'Bearer ' + token } })
            .then(function(r) { return r.json(); })
            .then(function(res2) {
              return (res2 && res2.files && res2.files[0]) || null;
            });
        })
        .catch(function() { return null; });
    });
  }

  // True when we hold a still-valid access token, so callers can decide
  // whether a Drive action will need an interactive OAuth popup. The popup
  // can only open from a fresh user gesture — after the OS file-picker dialog
  // the page's transient activation has usually expired, so uploads that need
  // a new token must be (re)triggered from a dedicated "Connect" click.
  function hasValidToken() {
    return !!(accessToken && Date.now() < tokenExpiresAt - 30000);
  }

  window.GDrive = {
    uploadBlob: uploadBlob,
    uploadBlobToSubfolder: uploadBlobToSubfolder,
    findOrCreateFolder: findOrCreateFolder,
    findFileInCourseTree: findFileInCourseTree,
    folderIdFromUrl: folderIdFromUrl,
    getAccessToken: getAccessToken,
    hasValidToken: hasValidToken
  };
})();
