/**
 * Dog Friendly Ireland: creates the "Suggest a place" Google Form and its approval sheet.
 *
 * How to use:
 * 1. Go to https://script.new while signed in to the Google account that should own the form.
 * 2. Delete the sample code, paste all of this in, and click Run.
 * 3. Allow access when Google asks. Because this is your own script, Google may say it "hasn't verified this app":
 *    click Advanced, then "Go to Untitled project", then Allow.
 * 4. When it finishes, open View > Logs (or the Execution log panel) and copy the two lines that start
 *    FORM_SETTINGS and SHEET_CSV. Send them to Claude, or paste them into js/config.js and
 *    scripts/suggestions-url.txt yourself.
 *
 * It creates two files in your Google Drive: the form, and a sheet where suggestions arrive.
 * To approve a suggestion, type yes in its Approved cell.
 */
function createSuggestForm() {
  var form = FormApp.create('Dog Friendly Ireland: suggest a place');
  form.setDescription('Suggestions from the Dog Friendly Ireland app. Nothing is published until it is approved.');
  form.setCollectEmail(false);
  form.setAllowResponseEdits(false);
  form.setLimitOneResponsePerUser(false);
  form.setConfirmationMessage('Thanks! We will check this place before it appears in the app.');

  var questions = [
    ['name', 'Name of the place', true, 'text'],
    ['town', 'Town or area', true, 'text'],
    ['county', 'County', true, 'text'],
    ['type', 'Type of place', true, 'text'],
    ['dogs', 'Where are dogs allowed?', true, 'text'],
    ['link', 'Website, Facebook or Instagram link', false, 'text'],
    ['notes', 'Anything dog owners should know?', false, 'paragraph'],
    ['owner', 'I own or work here', false, 'text']
  ];
  var items = questions.map(function (q) {
    var item = q[3] === 'paragraph' ? form.addParagraphTextItem() : form.addTextItem();
    item.setTitle(q[1]).setRequired(q[2]);
    return item;
  });

  // Work out the entry numbers the app needs by building a pre-filled link
  var response = form.createResponse();
  items.forEach(function (item, i) {
    var r = item.createResponse('v' + i);
    response.withItemResponse(r);
  });
  var prefilled = response.toPrefilledUrl();
  var fields = {};
  questions.forEach(function (q, i) {
    var m = prefilled.match(new RegExp('entry\\.(\\d+)=v' + i + '(&|$)'));
    if (m) fields[q[0]] = 'entry.' + m[1];
  });
  var action = form.getPublishedUrl().replace(/\/viewform.*$/, '/formResponse');

  // Responses go to a sheet with an Approved column
  var ss = SpreadsheetApp.create('Dog Friendly Ireland: suggestions');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  SpreadsheetApp.flush();
  Utilities.sleep(3000);
  ss = SpreadsheetApp.openById(ss.getId());
  var sheet = ss.getSheets().filter(function (s) { return s.getFormUrl(); })[0] || ss.getSheets()[0];
  var col = questions.length + 2; // timestamp + answers, then Approved
  sheet.getRange(1, col).setValue('Approved').setFontWeight('bold').setBackground('#fff3cd');
  sheet.setFrozenRows(1);
  // Remove the empty starter tab if Google added one
  ss.getSheets().forEach(function (s) { if (s.getSheetId() !== sheet.getSheetId() && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s); });

  // Let the app's nightly update read the sheet (anyone with the link can view; it holds no personal details)
  DriveApp.getFileById(ss.getId()).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  var csv = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=csv&gid=' + sheet.getSheetId();

  Logger.log('Form (for you): ' + form.getEditUrl());
  Logger.log('Sheet (for you): ' + ss.getUrl());
  Logger.log('FORM_SETTINGS ' + JSON.stringify({ action: action, fields: fields }));
  Logger.log('SHEET_CSV ' + csv);
}
