import { Parser } from 'hot-formula-parser';

const formulaParser = new Parser();

let cellLookupFunction = (ri, ci) => { return null; };
const configureCellLookupFunction = (fn) => { cellLookupFunction = fn; }

let cellStack = [];

const isFormula = (src) => {
  return src && src.length > 0 && src[0] === '=';
}

// Whenever formulaParser.parser encounters a cell reference, it will
// execute this callback to query the true value of that cell reference.
// If the referenced cell contains a formula, we need to use formulaParser
// to determine its value---which will then trigger more callCellValue
// events to computer the values of its cell references. This recursion
// will continue until the original formula is fully resolved.
const getFormulaParserCellValueFromCoord = function(cellCoord) {
  const cell = cellLookupFunction(cellCoord.row.index, cellCoord.column.index);

  if (!cell) return '';

  return cell._getFormulaParserCellValueFromText(cell.getText());
}

formulaParser.on('callCellValue', function(cellCoord, done) {
  console.log('callCellValue', cellCoord);
  const cellValue = getFormulaParserCellValueFromCoord(cellCoord);
  done(cellValue);
});

formulaParser.on('callRangeValue', function (startCellCoord, endCellCoord, done) {
  let fragment = [];

  for (let row = startCellCoord.row.index; row <= endCellCoord.row.index; row++) {
    let colFragment = [];

    for (let col = startCellCoord.column.index; col <= endCellCoord.column.index; col++) {
      // Copy the parts of the structure of a Parser cell coordinate used
      // by getFormulaParserCellValue
      const constructedCellCoord = {
        row: { index: row },
        column: { index: col }
      };
      const cellValue = getFormulaParserCellValueFromCoord(constructedCellCoord);

      colFragment.push(cellValue);
    }
    fragment.push(colFragment);
  }

  done(fragment);
});

class Cell {
  constructor(ri, ci, properties) {
    this.ri = ri;
    this.ci = ci;
    this.value = null;
    this.updated = true;
    this.uses = [];
    this.usedBy = new Map();

    if (properties === undefined)
      return;

    // Properties that may exist:
    // - text
    // - style
    // - merge
    // - editable
    this.set(properties);
  }

  setText(text) {
    if (!this.isEditable())
      return;

    this.text = text;
    this.updated = false;

    this.calculateValueFromText();
  }

  set(fieldInfo, what = 'all') {
    if (!this.isEditable())
      return;

    if (what === 'all') {
      Object.keys(fieldInfo).forEach((fieldName) => {
        if (fieldName === 'text') {
          this.setText(fieldInfo.text);
        } else {
          this[fieldName] = fieldInfo[fieldName];
        }
      });
    } else if (what === 'text') {
      this.setText(fieldInfo.text);
    } else if (what === 'format') {
      this.style = fieldInfo.style;
      if (this.merge) this.merge = fieldInfo.merge;
    }
  }

  isEditable() {
    return this.editable !== false;
  }

  delete(what) {
    if (!this.isEditable())
      return;

    // Note: deleting the cell (what === 'all') needs to be handled at a
    // higher level (the row object).
    if (what === 'text') {
      if (this.text) delete this.text;
      if (this.value) delete this.value;
      this.updated = true;

      // TODO: Update dependencies
    } else if (what === 'format') {
      if (this.style !== undefined) delete this.style;
      if (this.merge) delete this.merge;
    } else if (what === 'merge') {
      if (this.merge) delete this.merge;
    }
  }

  getText() {
    return this.text || '';
  }

  getValue() {
    if (isFormula(this.text))
      return this.value;

    return this.getText();
  }

  calculateValueFromText() {
    console.log('calc value from text', this);
    if (this.text === undefined) return;

    cellStack = [];

    this._getFormulaParserCellValueFromText(this.text);
  }

  usedByCell(cell) {
    // Create Map for row if none exists yet
    if (!this.usedBy.has(cell.ri)) this.usedBy.set(cell.ri, new Map());

    this.usedBy.get(cell.ri).set(cell.ci, cell);
  }

  noLongerUsedByCell(cell) {
    if (!this.usedBy.has(cell.ri)) return;

    this.usedBy.get(cell.ri).delete(cell.ci);

    // Delete Map for row if now empty
    if (this.usedBy.get(cell.ri).size == 0) this.usedBy.delete(cell.ri);
  }

  _getFormulaParserCellValueFromText(src) {
    cellStack.push(this);

    if (this.updated) return this.value;

    // Copy of existing array of cells used by this formula;
    // will be used to see how dependencies have changed.
    let oldUses = this.uses.slice();
    this.uses = [];

    if (isFormula(src)) {
      const parsedResult = formulaParser.parse(src.slice(1));
      console.log('parsed', src, ' -> ', parsedResult.result, cellStack);

      src = (parsedResult.error) ?
                parsedResult.error :
                parsedResult.result;

      // Store new dependencies of this cell by popping cells off the cell stack
      // until this cell is reached.
      while (this !== cellStack[cellStack.length - 1]) {
        this.uses.push(cellStack.pop());
      }

      console.log(src, ' depends on ', this.uses);
    }

    // The source string no longer contains a formula,
    // so return its contents as a value.
    // If said string is a number, return as a number;
    // otherwise, return as a string.
    this.value = Number(src) || src;
    this.updated = true;

    // ------------------------------------------------------------------------
    // Update cell reference dependencies and trigger update of dependent cells

    // Build temporary weakmaps from the previous and current arrays of cells
    // used by this cell's formula for faster determination of how those
    // dependencies have changed (than comparing two arrays).
    const oldUsesWeakMap = new WeakMap();
    oldUses.forEach((cell) => oldUsesWeakMap.set(cell, true));

    const usesWeakMap = new WeakMap();
    this.uses.forEach((cell) => usesWeakMap.set(cell, true));

    // Cells that this cell's formula previously used, but no longer does
    const noLongerUses = oldUses.filter((cell) => !usesWeakMap.has(cell));

    // Notify cells no longer in use that this cell no longer depends on
    // them, and therefore doesn't need to be forced to update when they do.
    noLongerUses.forEach((cell) => cell.noLongerUsedByCell(this));

    // Cells that this cell's formula didn't previously use, but now does
    const nowUses = this.uses.filter((cell) => !oldUsesWeakMap.has(cell));

    // Notify cells now in use that this cell needs to be forced to update
    // when they do.
    nowUses.forEach((cell) => cell.usedByCell(this));

    console.log('removed: ', noLongerUses, ' | added: ', nowUses);

    // Iterate through this cell's registry of cells that use it and force them
    // to update.
    this.usedBy.forEach((columnMap, ri) => {
      columnMap.forEach((cell, ci) => cell._getFormulaParserCellValueFromText());
    });

    return this.value;
  };
}

export default {
  Cell: Cell,
  configureCellLookupFunction: configureCellLookupFunction,
};

export {
  Cell,
  configureCellLookupFunction,
};
