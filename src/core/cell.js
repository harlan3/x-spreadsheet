import { Parser } from 'hot-formula-parser';

import helper from './helper';

const formulaParser = new Parser();

let cellGetOrNewFunction = (ri, ci) => { return null; };
const configureCellGetOrNewFunction = (fn) => { cellGetOrNewFunction = fn; }

let cellDependencies = [];
let resetDependencies = false;

const isFormula = (src) => {
  return src && src.length > 0 && src[0] === '=';
}

// Whenever formulaParser.parser encounters a cell reference, it will
// execute this callback to query the true value of that cell reference.
// This function will *always* return the cached value of that cell reference
// rather than recomputing it. Because only one cell can be modified/parsed at
// a time and the rest were previously computed, there is no need to recompute
// the value of the references. If the cell being parsed has a dependency
// cycle, we avoid inifite recursion by using the cached value; this circular
// dependency will be detected and addressed elsewhere (see
// updateDependenciesWithCycleCheck).

const getCachedCellValueFromCoord = function(cellCoord) {
  const cell = cellGetOrNewFunction(cellCoord.row.index, cellCoord.column.index);

  if (resetDependencies) {
    cellDependencies.push(cell);
  }

  return cell.getValue();
}

formulaParser.on('callCellValue', function(cellCoord, done) {
  const cellValue = getCachedCellValueFromCoord(cellCoord);
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
      const cellValue = getCachedCellValueFromCoord(constructedCellCoord);

      colFragment.push(cellValue);
    }
    fragment.push(colFragment);
  }

  done(fragment);
});

let lastCellId = 0;

class Cell {
  constructor(properties) {
    // cellId is used to identify a cell in the usedBy Map.
    // We can't use the cell itself as a key in a WeakMap because WeakMaps are
    // not iterable, and we need usedBy to be iterable.
    lastCellId++;
    this.cellId = lastCellId;

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

    this.updateValueFromText();
  }

  set(fieldInfo, what = 'all') {
    if (!this.isEditable())
      return;

    if (what === 'all') {
      // Always update the text field, even if undefined (treated as an empty
      // string). This allows a cell state to correctly update if it's state
      // moves {text: 'some value'} to {}, such as can occur in undo/redo.
      this.setText(fieldInfo.text);

      // Update all other fields (besides text)
      Object.keys(fieldInfo).forEach((fieldName) => {
        if (fieldName !== 'text') {
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
    return this.value;
  }

  updateValueFromTextInternal() {
    let src = this.state.text;

    if (isFormula(src)) {
      // All dependent cells referenced are added to cellDependencies by the
      // callCellValue and callRangeValue event handlers
      const parsedResult = formulaParser.parse(src.slice(1));
      src = (parsedResult.error) ?
                parsedResult.error :
                parsedResult.result;
    }

    // The source string no longer contains a formula,
    // so return its contents as a value.
    // Else if said string is a number, return as a number;
    // otherwise, return as a string.
    // Else (e.g., src is undefined), return an empty string.
    this.value = Number(src) || src || '';
  }

  updateValueFromText() {
    cellDependencies = [];

    resetDependencies = true;
    this.updateValueFromTextInternal();
    resetDependencies = false;

    // Copy of existing array of cells used by this formula;
    // will be used to see how dependencies have changed.
    let oldUses = new Set(this.uses);
    this.uses = new Set(cellDependencies);

    // ------------------------------------------------------------------------
    // Update cell reference dependencies

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

    // ------------------------------------------------------------------------
    // Trigger update of dependent cells and check for dependency graph cycles

    const dfsStack = [];
    const visitedMap = new WeakMap();

    const updateDependenciesWithCycleCheck = (cell) => {
      // Check for cycles:
      // If current cell is already in the dfsStack, there is a cycle from that
      // index to the end of the stack
      const indexOfCycleStart = dfsStack.indexOf(cell);
      if (indexOfCycleStart >= 0) {
        const cellsInCycle = new Set(dfsStack.slice(indexOfCycleStart));

        // Visit/revisit all dependencies of current cell once and update their
        // values to reflect their relationship to the cycle.
        const tempVisitedMap = new WeakMap();
        const updateValueInCycleAndDependencies = (cycleDependentCell) => {
          if (tempVisitedMap.has(cycleDependentCell)) return;

          tempVisitedMap.set(cycleDependentCell, true);

          cycleDependentCell.value = (cellsInCycle.has(cycleDependentCell)) ? '#CIRCULAR-REF' : '#ERROR';

          cycleDependentCell.forEachUsedBy((nextCell) => updateValueInCycleAndDependencies(nextCell));
        };
        updateValueInCycleAndDependencies(cell);
      }

      // If this cell has been visited before, return early to avoid both
      // unnecessary computation and a possible cycle when iterating through
      // dependent cells.
      if (visitedMap.has(cell)) return;

      // Add to stack before recursion so dependent cells can include this cell
      // in their cycle check
      dfsStack.push(cell);
      visitedMap.set(cell, true);

      // Iterate through all dependent cells,
      // trigger them to update the values of themselves and their dependencies.
      cell.forEachUsedBy((dependentCell) => {
        // Trigger the cell to update; because if is using cached cell values
        // rather than recalculating them, we don't have to worry about
        // causing infinite recursion in case of cycles.
        dependentCell.updateValueFromTextInternal();

        // Trigger the cell to update its own dependencies
        updateDependenciesWithCycleCheck(dependentCell);
      });

      // Remove self from the stack
      dfsStack.pop();
    };

    updateDependenciesWithCycleCheck(this);
  }

  usedByCell(cell) {
    this.usedBy.set(cell.id, cell);
  }

  noLongerUsedByCell(cell) {
    this.usedBy.delete(cell.id);
  }

  forEachUsedBy(functionUsingCell) {
    this.usedBy.forEach((cell, cellId) => functionUsingCell(cell));
  }

  getStateCopy() {
    return helper.cloneDeep(this.state);
  }
}

export default {
  Cell: Cell,
  configureCellGetOrNewFunction: configureCellGetOrNewFunction,
  isFormula: isFormula,
};

export {
  Cell,
  configureCellGetOrNewFunction,
  isFormula,
};
