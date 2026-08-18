/** True while any sample-editor dialog is open — SampleLibraryView reads this
 *  to suppress note-key preview during dialogs. Lives in its own module so
 *  importing it never drags in a component. */
export const sampleDialogOpenRef = { current: false }
