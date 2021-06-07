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

  return cell.getFormulaParserCellValueFromText(cell.getText());
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

    if (properties === undefined)
      return;

    // Properties that may exist:
    // - text
    // - style
    // - merge
    // - editable
    this.set(properties);

    this.uses = [];
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

    this.getFormulaParserCellValueFromText(this.text);
    console.log('full stack', cellStack);
  }

  getFormulaParserCellValueFromText(src) {
    cellStack.push(this);

    if (this.updated) return this.value;

    if (isFormula(src)) {
      const parsedResult = formulaParser.parse(src.slice(1));
      console.log('parsed', src, ' -> ', parsedResult.result, cellStack);

      // !!!! THIS IS WHERE DEPENDENCIES COME FROM!
      let newUses = [];
      while (this !== cellStack[cellStack.length - 1]) {
        newUses.push(cellStack.pop());
      }
      this.uses = newUses;
      console.log(src, ' depends on ', this.uses);

      src = (parsedResult.error) ?
                parsedResult.error :
                parsedResult.result;
    }

    // The source string no longer contains a formula,
    // so return its contents as a value.
    // If said string is a number, return as a number;
    // otherwise, return as a string.
    this.value = Number(src) || src;
    this.updated = true;

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
