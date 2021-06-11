// import helper from '../helper';

export default class History {
  constructor() {
    this.undoItems = [];
    this.redoItems = [];
  }

  add(data) {
    console.log('save point', data);
    this.undoItems.push(JSON.stringify(data));
    this.redoItems = [];
  }

  canUndo() {
    return this.undoItems.length > 0;
  }

  canRedo() {
    return this.redoItems.length > 0;
  }

  undo(currentd, cb) {
    const { undoItems, redoItems } = this;
    if (this.canUndo()) {
      console.log('undo', currentd);
      redoItems.push(JSON.stringify(currentd));
      cb(JSON.parse(undoItems.pop()));
    }
  }

  redo(currentd, cb) {
    const { undoItems, redoItems } = this;
    if (this.canRedo()) {
      console.log('redo', currentd);
      undoItems.push(JSON.stringify(currentd));
      cb(JSON.parse(redoItems.pop()));
    }
  }
}
