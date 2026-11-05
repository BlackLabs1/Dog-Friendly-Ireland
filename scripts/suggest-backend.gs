/**
 * @OnlyCurrentDoc
 * Dog Friendly Ireland: receives "Suggest a place" entries from the app, including an optional photo.
 * Entries go to the "App suggestions" tab of the suggestions sheet; photos go to a Drive folder.
 * Nothing appears in the app until you type yes in the Approved column.
 *
 * This script lives inside the suggestions sheet (Extensions > Apps Script) and can only use that sheet,
 * plus the photo folder and photos it creates itself (see appsscript.json in the same project).
 *
 * Set up once:
 *  1. In the Apps Script editor, run setup (allow access when asked). The log shows SHEET_CSV: send it to Claude.
 *  2. Deploy > New deployment > type "Web app". Execute as: Me. Who has access: Anyone. Deploy.
 *     Copy the Web app URL (ends in /exec) and send it to Claude.
 */
var TAB = 'App suggestions';
var FOLDER = 'Dog Friendly Ireland: suggested photos';
var HEAD = ['Timestamp', 'Name of the place', 'Address', 'Town', 'County', 'Postcode', 'Type of place', 'Where are dogs allowed?',
  'Link', 'Anything dog owners should know?', 'I own or work here', 'Photo', 'Photo permission', 'Approved'];

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(TAB);
  if (!sh) {
    sh = ss.insertSheet(TAB);
    sh.appendRow(HEAD);
    sh.getRange(1, 1, 1, HEAD.length).setFontWeight('bold');
    sh.getRange(1, HEAD.length).setBackground('#fff3cd');
    sh.setFrozenRows(1);
  }
  folder_();
  Logger.log('SHEET_CSV https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=csv&gid=' + sh.getSheetId());
}

// The photo folder is created by this script, so it can use it without access to the rest of Drive
function folder_() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var f = DriveApp.createFolder(FOLDER);
  props.setProperty('FOLDER_ID', f.getId());
  return f;
}
function clip_(v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n); }
// Stops spreadsheet formulas being injected through the form
function cell_(v, n) { var s = clip_(v, n); return /^[=+\-@]/.test(s) ? "'" + s : s; }

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var d = JSON.parse(e.postData.contents);
    if (d.website) return out_('ok');                       // hidden field only robots fill in
    if (!clip_(d.name, 120) || !clip_(d.address, 200) || !clip_(d.county, 40)) return out_('missing');
    var photo = '';
    var m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(d.photo || '');
    if (m && m[2].length < 8000000 && d.photoOk) {
      var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), 'image/' + m[1],
        clip_(d.name, 60).replace(/[^\w ]+/g, '') + ' ' + new Date().toISOString().slice(0, 10) + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]));
      var file = folder_().createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      photo = file.getId();
    }
    lock.waitLock(20000);
    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB);
    sh.appendRow([new Date(), cell_(d.name, 120), cell_(d.address, 200), cell_(d.town, 80), cell_(d.county, 40), cell_(d.postcode, 12),
      cell_(d.type, 60), cell_(d.dogs, 30), cell_(d.link, 300), cell_(d.notes, 500), d.owner ? 'Yes' : 'No', photo,
      photo ? 'Yes' : '', '']);
    return out_('ok');
  } catch (err) {
    return out_('error');
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}
function out_(s) { return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.TEXT); }
