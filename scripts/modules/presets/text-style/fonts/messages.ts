import { message } from "../../../../../shared/i18n/message.ts";
export const fontMessages = {
  label: message("loreloom.textStyle.font", "Font"),
  default: message("loreloom.textStyle.defaultFont", "Default font"),
  download: message("loreloom.textStyle.fontDownload", "Download"),
  update: message("loreloom.textStyle.fontUpdate", "Update"),
  remove: message("loreloom.textStyle.fontDelete", "Delete"),
  refreshing: message(
    "loreloom.textStyle.fontRefreshing",
    "Refreshing font list...",
  ),
  downloading: message(
    "loreloom.textStyle.fontDownloading",
    "Downloading {progress}%",
  ),
  verifying: message("loreloom.textStyle.fontVerifying", "Verifying..."),
  saving: message("loreloom.textStyle.fontSaving", "Saving..."),
  preparing: message("loreloom.textStyle.fontPreparing", "Preparing upload..."),
  uploading: message(
    "loreloom.textStyle.fontUploading",
    "Uploading {progress}%",
  ),
  uploadingPending: message(
    "loreloom.textStyle.fontUploadingPending",
    "Uploading...",
  ),
  readingBack: message(
    "loreloom.textStyle.fontReadingBack",
    "Verifying file {progress}%",
  ),
  loading: message(
    "loreloom.textStyle.fontLoading",
    "Loading font {progress}%",
  ),
  parsing: message("loreloom.textStyle.fontParsing", "Parsing font..."),
  applying: message("loreloom.textStyle.fontApplying", "Applying font..."),
  deleting: message("loreloom.textStyle.fontDeleting", "Deleting..."),
  checking: message(
    "loreloom.textStyle.fontChecking",
    "Checking server files...",
  ),
  helperRequired: message(
    "loreloom.textStyle.fontHelperRequired",
    "Font management requires Tavern Helper and access to SillyTavern files.",
  ),
  failed: message("loreloom.textStyle.fontFailed", "Operation failed: {error}"),
  cachedCatalog: message(
    "loreloom.textStyle.fontCachedCatalog",
    "Could not refresh the font list. Using the last available list.",
  ),
  missing: message(
    "loreloom.textStyle.fontMissing",
    "Server file is missing. Download again.",
  ),
};
