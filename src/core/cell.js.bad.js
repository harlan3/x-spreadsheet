import { Parser } from 'hot-formula-parser';

import helper from './helper';

const formulaParser = new Parser();

let cellGetOrNewFunction = (ri, ci) => { return null; };
const configureCellGetOrNewFunction = (fn) => { cellGetOrNewFunction = fn; }

let cellStack = [];
let dependencyLevel = 0;
let resetDependencies = false;

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
  const cell = cellGetOrNewFunction(cellCoord.row.index, cellCoord.column.index);

  if (!cell) return '';

  return cell._recalculateCellValueFromText(cell.getText());
}

formulaParser.on('callCellValue', function(cellCoord, done) {
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
    this.updated = true;
    this.uses = new Set();
    this.usedBy = new Map();

    // State contains what can be saved/restored
    this.state = {};
    this.value = '';

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

    // No reason to recompute if text is unchanged
    if (this.state.text === text)
      return;

    this.state.text = text;
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
          this.state[fieldName] = fieldInfo[fieldName];
        }
      });
    } else if (what === 'text') {
      this.setText(fieldInfo.text);
    } else if (what === 'format') {
      this.state.style = fieldInfo.style;
      if (this.state.merge) this.state.merge = fieldInfo.merge;
    }
  }

  isEditable() {
    return this.state.editable !== false;
  }

  // Returns true if cell should be deleted at a higher level (row object)
  delete(what) {
    // Can't delete if not editable, so return false
    if (!this.isEditable())
      return false;

    // Note: deleting the cell (what === 'all') needs to be handled at a
    // higher level (the row object).
    const deleteAll = what === 'all';

    if (what === 'text' || deleteAll) {
      // if (this.state.text) delete this.state.text;
      this.setText(undefined);

      this.calculateValueFromText();
    }
    if (what === 'format' || deleteAll) {
      if (this.state.style !== undefined) delete this.state.style;
      if (this.state.merge) delete this.state.merge;
    }
    if (what === 'merge' || deleteAll) {
      if (this.state.merge) delete this.state.merge;
    }

    // Note: deleting the cell needs to be handled at a higher level (the row
    // object). This should only be done if what === 'all' and this cell is
    // not currently used by any other cells.
    const shouldDelete = deleteAll && this.usedBy.size == 0;
    return shouldDelete;
  }

  getText() {
    return this.state.text || '';
  }

  getValue() {
    if (isFormula(this.state.text))
      return this.value;

    return this.getText();
  }

  calculateValueFromText() {
    cellStack = [];
    dependencyLevel = 0;

    resetDependencies = true;
    this._recalculateCellValueFromText();
    resetDependencies = false;
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

  _recalculateCellValueFromText() {
    let src = this.state.text;

    // Need to store here rather than later in the function in case calls to
    // formulaParser.parse cause resetDependencies to be modified
    // let originalResetDependenciesState = resetDependencies;

    // Only necessary if dependencies are being reset.
    if (resetDependencies) {
      cellStack.push({
        cell: this,
        visited: this.updated
      });
    }

    if (this.updated) return this.value;

    // Copy of existing array of cells used by this formula;
    // will be used to see how dependencies have changed.
    let oldUses = new Set(this.uses);
    this.uses = new Set();

    if (isFormula(src)) {
      // dependencyLevel++;
      const parsedResult = formulaParser.parse(src.slice(1));
      // dependencyLevel--;
      src = (parsedResult.error) ?
                parsedResult.error :
                parsedResult.result;

      if (resetDependencies) {
        // Store new dependencies of this cell by popping cells off the cell stack
        // until this cell is reached.
        while (this !== cellStack[cellStack.length - 1].cell) {
          this.uses.add(cellStack.pop().cell);
        }

        // A circular dependency exists if there are two identical cells with
        // different dependency levels.
        const dependencyTracker = new WeakMap();
        this.circular = cellStack.some(({cell, level}) => {
          const mapOfLevelsForCell = dependencyTracker.get(cell);

          if (mapOfLevelsForCell === undefined) {
            dependencyTracker.set(cell, new Map([[level, true]]));
          } else {
            if (mapOfLevelsForCell.has(level)) {
              console.log('circular at ', cell, cellStack);
              return true;
            }
          }
          
          return false;
        });

        if (this.circular) {
          src = '#CIRCULAR';
        }
      }
    } else {
      // Non-formulas can't be circular
      this.circular = false;
    }

    // The source string no longer contains a formula,
    // so return its contents as a value.
    // Else if said string is a number, return as a number;
    // otherwise, return as a string.
    // Else (e.g., src is undefined), return an empty string.
    this.value = Number(src) || src || '';
    this.updated = true;

    // ------------------------------------------------------------------------
    // Update cell reference dependencies and trigger update of dependent cells

    if (resetDependencies) {
      // Build temporary weakmaps from the previous and current arrays of cells
      // used by this cell's formula for faster determination of how those
      // dependencies have changed (than comparing two arrays).
      const oldUsesWeakMap = new WeakMap();
      oldUses.forEach((cell) => oldUsesWeakMap.set(cell, true));

      const usesWeakMap = new WeakMap();
      this.uses.forEach((cell) => usesWeakMap.set(cell, true));

      // Cells that this cell's formula previously used, but no longer does
      const noLongerUses = Array.from(oldUses).filter((cell) => !usesWeakMap.has(cell));

      // Notify cells no longer in use that this cell no longer depends on
      // them, and therefore doesn't need to be forced to update when they do.
      noLongerUses.forEach((cell) => cell.noLongerUsedByCell(this));

      // Cells that this cell's formula didn't previously use, but now does
      const nowUses = Array.from(this.uses).filter((cell) => !oldUsesWeakMap.has(cell));

      // Notify cells now in use that this cell needs to be forced to update
      // when they do.
      nowUses.forEach((cell) => cell.usedByCell(this));
    }

    // ------------------------------------------------------------------------
    // Iterate through this cell's registry of cells that use it and force them
    // to update their value, but change no dependencies.

    // Dependencies should not be updated in these calls. This also keeps the
    // cellStack unmodified by triggered updates.
    let originalResetDependenciesState = resetDependencies;
    resetDependencies = false;

    this.usedBy.forEach((columnMap, ri) => {
      columnMap.forEach((cell, ci) => {
        // If this cell is circular AND the next cell is circular, skip it to
        // avoid infinite recursion.
        // If the user edits a previously circular cell such that it is no
        // longer circular (this.circular == false), recompute the cells it is
        // used by to see if their circularity has been resolved.
        if (this.circular && cell.circular) return;

        // Force update
        cell.updated = false;
        cell._recalculateCellValueFromText();
      });
    });

    // Restore original resetDependencies state.
    // For cells in this.usedBy forced to recalculate, resetDependencies will
    // restore to false ensuring that nothing in this.usedBy recalculates its
    // dependencies.
    // For cells parsed as a result of a calculateValueFromText call, this will
    // restore to true ensuring that dependencies are updated.
    resetDependencies = originalResetDependenciesState;

    return this.value;
  };

  getStateCopy() {
    return helper.cloneDeep(this.state);
  }
}

export default {
  Cell: Cell,
  configureCellGetOrNewFunction: configureCellGetOrNewFunction,
};

export {
  Cell,
  configureCellGetOrNewFunction,
};












import { Parser } from 'hot-formula-parser';

import helper from './helper';

const formulaParser = new Parser();

let cellGetOrNewFunction = (ri, ci) => { return null; };
const configureCellGetOrNewFunction = (fn) => { cellGetOrNewFunction = fn; }

let cellStack = [];
// let resetDependencies = false;

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
  const cell = cellGetOrNewFunction(cellCoord.row.index, cellCoord.column.index);

  if (!cell) return '';

  return cell._recalculateCellValueFromText(cell.getText());
}

formulaParser.on('callCellValue', function(cellCoord, done) {
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
    this.updated = true;
    this.uses = [];
    this.usedBy = new Map();

    // State contains what can be saved/restored
    this.state = {};
    this.value = '';

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

    // No reason to recompute if text is unchanged
    if (this.state.text === text)
      return;

    this.state.text = text;
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
          this.state[fieldName] = fieldInfo[fieldName];
        }
      });
    } else if (what === 'text') {
      this.setText(fieldInfo.text);
    } else if (what === 'format') {
      this.state.style = fieldInfo.style;
      if (this.state.merge) this.state.merge = fieldInfo.merge;
    }
  }

  isEditable() {
    return this.state.editable !== false;
  }

  // Returns true if cell should be deleted at a higher level (row object)
  delete(what) {
    // Can't delete if not editable, so return false
    if (!this.isEditable())
      return false;

    // Note: deleting the cell (what === 'all') needs to be handled at a
    // higher level (the row object).
    const deleteAll = what === 'all';

    if (what === 'text' || deleteAll) {
      // if (this.state.text) delete this.state.text;
      this.setText(undefined);

      this.calculateValueFromText();
    }
    if (what === 'format' || deleteAll) {
      if (this.state.style !== undefined) delete this.state.style;
      if (this.state.merge) delete this.state.merge;
    }
    if (what === 'merge' || deleteAll) {
      if (this.state.merge) delete this.state.merge;
    }

    // Note: deleting the cell needs to be handled at a higher level (the row
    // object). This should only be done if what === 'all' and this cell is
    // not currently used by any other cells.
    const shouldDelete = deleteAll && this.usedBy.size == 0;
    return shouldDelete;
  }

  getText() {
    return this.state.text || '';
  }

  getValue() {
    if (isFormula(this.state.text))
      return this.value;

    return this.getText();
  }

  calculateValueFromText() {
    cellStack = [];

    // resetDependencies = true;
    this._recalculateCellValueFromText();
    // resetDependencies = false;
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

  _recalculateCellValueFromText() {
    console.log('eval ', this.state.text);
    let src = this.state.text;

    // Need to store here rather than later in the function in case calls to
    // formulaParser.parse cause resetDependencies to be modified
    // let originalResetDependenciesState = resetDependencies;

    // Only necessary if dependencies are being reset.
    // if (resetDependencies) {
      cellStack.push(this);
    // }

    if (this.updated) return this.value;

    // Copy of existing array of cells used by this formula;
    // will be used to see how dependencies have changed.
    let oldUses = this.uses.slice();
    this.uses = [];

    if (isFormula(src)) {
      const parsedResult = formulaParser.parse(src.slice(1));
      src = (parsedResult.error) ?
                parsedResult.error :
                parsedResult.result;

      // if (resetDependencies) {
        // Store new dependencies of this cell by popping cells off the cell stack
        // until this cell is reached.
        while (this !== cellStack[cellStack.length - 1]) {
          this.uses.push(cellStack.pop());
        }
        // Because this is DFS, whatever is below us
        if (cellStack.length > 1) {
          const ownCell = cellStack.pop();
          cellStack[cellStack.length - 1].uses.push(ownCell);
        }
        console.log(this, this.uses);

        // A circular dependency exists if there are two identical cells in the stack.
        const dependencyTracker = new WeakMap();
        this.circular = cellStack.some((cell) => {
          if (dependencyTracker.has(cell)) {
            console.log('!!!! CIRC');
            return true;
          }

          dependencyTracker.set(cell, true);
          return false;
        });

        // const recursiveCircularDependencyCheck = (cellToCheckDependencies) => {
        //   // A circular dependency is detected if either:
        //   // - cellToCheckDependencies uses this cell
        //   // - a cell used (recursively) by cellToCheckDependencies uses this cell
        //   return cellToCheckDependencies.uses.some((cell) => {
        //     if (cell === this) return true;

        //     return recursiveCircularDependencyCheck(cell);
        //   });
        // };

        // this.circular = recursiveCircularDependencyCheck(this);
        if (this.circular) {
          src = '#CIRCULAR';
        }
      // }
    } else {
      // Non-formulas can't be circular
      this.circular = false;
    }

    // The source string no longer contains a formula,
    // so return its contents as a value.
    // Else if said string is a number, return as a number;
    // otherwise, return as a string.
    // Else (e.g., src is undefined), return an empty string.
    this.value = Number(src) || src || '';
    this.updated = true;

    // ------------------------------------------------------------------------
    // Update cell reference dependencies and trigger update of dependent cells

    // if (resetDependencies) {
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
    // }

    // ------------------------------------------------------------------------
    // Iterate through this cell's registry of cells that use it and force them
    // to update their value, but change no dependencies.

    // Dependencies should not be updated in these calls. This also keeps the
    // cellStack unmodified by triggered updates.
    // let originalResetDependenciesState = resetDependencies;
    // resetDependencies = false;

    this.usedBy.forEach((columnMap, ri) => {
      columnMap.forEach((cell, ci) => {
        // If this cell is circular AND the next cell is circular, skip it to
        // avoid infinite recursion.
        // If the user edits a previously circular cell such that it is no
        // longer circular (this.circular == false), recompute the cells it is
        // used by to see if their circularity has been resolved.
        if (this.circular && cell.circular) return;

        // Force update
        cell.updated = false;
        cell._recalculateCellValueFromText();
      });
    });

    // Restore original resetDependencies state.
    // For cells in this.usedBy forced to recalculate, resetDependencies will
    // restore to false ensuring that nothing in this.usedBy recalculates its
    // dependencies.
    // For cells parsed as a result of a calculateValueFromText call, this will
    // restore to true ensuring that dependencies are updated.
    // resetDependencies = originalResetDependenciesState;

    return this.value;
  };

  getStateCopy() {
    return helper.cloneDeep(this.state);
  }
}

export default {
  Cell: Cell,
  configureCellGetOrNewFunction: configureCellGetOrNewFunction,
};

export {
  Cell,
  configureCellGetOrNewFunction,
};
