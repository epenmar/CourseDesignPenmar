from services.alt_text_validator import classify_alt_text, derive_filename_stem, is_filename_alt


def test_detects_alt_with_file_extension():
    assert classify_alt_text("Week 2 overview.png", "") == "filename_image_alt"


def test_detects_alt_matching_src_filename():
    assert is_filename_alt("Desktop view email confirmation", "https://canvas.example/files/Desktopviewemailconfirmation.png")
    assert classify_alt_text("Desktop view email confirmation", "https://canvas.example/files/Desktopviewemailconfirmation.png") == "filename_image_alt"


def test_uses_canvas_display_name_when_url_hides_filename():
    assert classify_alt_text("Module 1 diagram", "Module 1 diagram.jpg", "https://canvas.example/courses/1/files/123/download") == "filename_image_alt"


def test_descriptive_alt_is_ok():
    assert classify_alt_text("Student dashboard showing assignment due dates", "dashboard.png") is None


def test_splits_camel_case_filename_stem():
    assert derive_filename_stem("DesktopViewEmailConfirmation.png") == "Desktop View Email Confirmation"
