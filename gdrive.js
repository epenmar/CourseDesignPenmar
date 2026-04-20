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

  function uploadBlob(folderUrl, name, blob, mimeType, onProgress) {
    var folderId = folderIdFromUrl(folderUrl);
    if (!folderId) {
      return Promise.reject(new Error('No Drive folder configured for this course. Set the Google Drive Folder URL in Course Info.'));
    }
    return getAccessToken().then(function(token) {
      var metadata = { name: name, parents: [folderId] };
      if (mimeType) metadata.mimeType = mimeType;
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

  window.GDrive = {
    uploadBlob: uploadBlob,
    folderIdFromUrl: folderIdFromUrl,
    getAccessToken: getAccessToken
  };
})();
