import helper from './helper';
import { Cell, isFormula } from './cell';
import {
  expr2expr,
  expr2xy,
  xy2expr,
  REGEX_EXPR_GLOBAL,
  REGEX_EXPR_RANGE_GLOBAL,
} from './alphabet';

class Rows {
  constructor({ len, height }) {
    this._ = {};
    this.len = len;
    // default row height
    this.height = height;
  }

  getHeight(ri) {
    if (this.isHide(ri)) return 0;
    const row = this.get(ri);
    if (row && row.height) {
      return row.height;
    }
    return this.height;
  }

  setHeight(ri, v) {
    const row = this.getOrNew(ri);
    row.height = v;
  }

  unhide(idx) {
    let index = idx;
    while (index > 0) {
      index -= 1;
      if (this.isHide(index)) {
        this.setHide(index, false);
      } else break;
    }
  }

  isHide(ri) {
    const row = this.get(ri);
    return row && row.hide;
  }

  setHide(ri, v) {
    const row = this.getOrNew(ri);
    if (v === true) row.hide = true;
    else delete row.hide;
  }

  setStyle(ri, style) {
    const row = this.getOrNew(ri);
    row.style = style;
  }

  sumHeight(min, max, exceptSet) {
    return helper.rangeSum(min, max, (i) => {
      if (exceptSet && exceptSet.has(i)) return 0;
      return this.getHeight(i);
    });
  }

  totalHeight() {
    return this.sumHeight(0, this.len);
  }

  get(ri) {
    return this._[ri];
  }

  getOrNew(ri) {
    this._[ri] = this._[ri] || { cells: {} };
    return this._[ri];
  }

  getCell(ri, ci) {
    const row = this.get(ri);
    if (row !== undefined && row.cells !== undefined && row.cells[ci] !== undefined) {
      return row.cells[ci];
    }
    return null;
  }

  getCellMerge(ri, ci) {
    const cell = this.getCell(ri, ci);
    if (cell && cell.state.merge) return cell.state.merge;
    return [0, 0];
  }

  getCellOrNew(ri, ci) {
    const row = this.getOrNew(ri);

    if (row.cells[ci] === undefined) {
      row.cells[ci] = new Cell();
    }

    return row.cells[ci];
  }

  setCell(ri, ci, fieldInfo, what) {
    const cell = this.getCellOrNew(ri, ci);
    cell.set(fieldInfo, what);
  }

  setCellTextGivenCell(cell, text) {
    if (cell.isEditable()) {
      cell.setText(text);
    }
  }

  setCellText(ri, ci, text) {
    const cell = this.getCellOrNew(ri, ci);
    this.setCellTextGivenCell(cell, text);
  }

  // what: all | format | text
  copyPaste(srcCellRange, dstCellRange, what, autofill = false, cb = () => {}) {
    const {
      sri, sci, eri, eci,
    } = srcCellRange;
    const dsri = dstCellRange.sri;
    const dsci = dstCellRange.sci;
    const deri = dstCellRange.eri;
    const deci = dstCellRange.eci;
    const [rn, cn] = srcCellRange.size();
    const [drn, dcn] = dstCellRange.size();
    // console.log(srcIndexes, dstIndexes);
    let isAdd = true;
    let dn = 0;
    if (deri < sri || deci < sci) {
      isAdd = false;
      if (deri < sri) dn = drn;
      else dn = dcn;
    }
    for (let i = sri; i <= eri; i += 1) {
      if (this._[i]) {
        for (let j = sci; j <= eci; j += 1) {
          if (this._[i].cells && this._[i].cells[j]) {
            for (let ii = dsri; ii <= deri; ii += rn) {
              for (let jj = dsci; jj <= deci; jj += cn) {
                const nri = ii + (i - sri);
                const nci = jj + (j - sci);
                // Get copy of current state of the cell being copied,
                // then modify before passing state to the destination cell.
                const ncellState = this._[i].cells[j].getStateCopy();
                if (autofill && ncellState && ncellState.text && ncellState.text.length > 0) {
                  let n = (jj - dsci) + (ii - dsri) + 2;
                  if (!isAdd) {
                    n -= dn + 1;
                  }
                  if (ncellState.text[0] === '=') {
                    ncellState.text = ncellState.text.replace(REGEX_EXPR_GLOBAL, (word) => {
                      let [xn, yn] = [0, 0];
                      if (sri === dsri) {
                        xn = n - 1;
                        // if (isAdd) xn -= 1;
                      } else {
                        yn = n - 1;
                      }
                      if (/^\d+$/.test(word)) return word;

                      // Set expr2expr to not perform translation on axes with an
                      // absolute reference
                      return expr2expr(word, xn, yn, false);
                    });
                  } else if ((rn <= 1 && cn > 1 && (dsri > eri || deri < sri))
                    || (cn <= 1 && rn > 1 && (dsci > eci || deci < sci))
                    || (rn <= 1 && cn <= 1)) {
                    const result = /[\\.\d]+$/.exec(ncellState.text);
                    // console.log('result:', result);
                    if (result !== null) {
                      const index = Number(result[0]) + n - 1;
                      ncellState.text = ncellState.text.substring(0, result.index) + index;
                    }
                  }
                }
                // Modify destination cell in-place, rather than replacing with
                // a new cell, to avoid breaking existing update dependency
                // maps to and from the destination cell.
                const ncell = this.getCellOrNew(nri, nci);
                ncell.set(ncellState);
                cb(nri, nci, ncell);
              }
            }
          }
        }
      }
    }
  }

  cutPaste(srcCellRange, dstCellRange) {
    const ncellmm = {};
    this.each((ri) => {
      this.eachCells(ri, (ci) => {
        let nri = parseInt(ri, 10);
        let nci = parseInt(ci, 10);
        if (srcCellRange.includes(ri, ci)) {
          nri = dstCellRange.sri + (nri - srcCellRange.sri);
          nci = dstCellRange.sci + (nci - srcCellRange.sci);
        }
        ncellmm[nri] = ncellmm[nri] || { cells: {} };
        ncellmm[nri].cells[nci] = this._[ri].cells[ci];
      });
    });
    this._ = ncellmm;
  }

  // src: Array<Array<String>>
  paste(src, dstCellRange) {
    if (src.length <= 0) return;
    const { sri, sci } = dstCellRange;
    src.forEach((row, i) => {
      const ri = sri + i;
      row.forEach((cell, j) => {
        const ci = sci + j;
        this.setCellText(ri, ci, cell);
      });
    });
  }

  insert(sri, n = 1) {
    // Step 1: Update all rows (shift as needed).
    const ndata = {};

    this.each((ri, row) => {
      let nri = parseInt(ri, 10);
      if (nri < sri) {
        // Row before insertion point:
        // Preserve row at same index as before
        ndata[nri] = row;
      } else {
        // Row is at/after insertion point:
        // Move row to new index offset by number of rows inserted
        ndata[nri + n] = row;
      }
    });

    this._ = ndata;
    this.len += n;

    // Step 2: For all cells which remain, make the following adjustments to
    // the cell references in their text string:
    // - Any reference after the insertion point must be downshifted by the
    //   number of inserted rows
    this.each((ri, row) => {
      this.eachCells(ri, (ci, cell) => {
        const cellText = cell.getText();
        if (isFormula(cellText)) {
          cell.setText(
            cellText.replace(REGEX_EXPR_GLOBAL, word => expr2expr(word, 0, n, true, (x, y) => y >= sri))
          );
        }
      });
    });
  }

  delete(sri, eri) {
    const n = eri - sri + 1;

    // Step 1: Update all rows (delete or shift as needed) and cleanup
    // relationships to cells in deleted rows.
    const ndata = {};

    this.each((ri, row) => {
      const nri = parseInt(ri, 10);
      if (nri < sri) {
        // Row is below deletion start index:
        // Preserve row at same index as before
        ndata[nri] = row;
      } else if (nri > eri) {
        // Row is above deletion end index:
        // Move row to new index offset by number of rows deleted
        ndata[nri - n] = row;
      } else {
        // Row is in deletion range:
        // Remove the connection between all cells in these rows and the cells
        // they depend on.
        this.eachCells(ri, (ci, cell) => {
          cell.uses.forEach((dependentCell) => dependentCell.noLongerUsedByCell(cell));
        });
      }
    });

    this._ = ndata;
    this.len -= n;

    // Step 2: For all cells which remain, make the following adjustments to
    // the cell references in their text string:
    // - For ranges
    //    - If the range is partly in the deleted zone, shift its start or end
    //      to be outside the deleted zone
    //    - If the range is fully in the deleted zone, return reference error
    // - For single references
    //    - Any reference in the deleted range should be replaced with 'REF',
    //      indicating a reference error
    //    - Any reference above the deleted range must be downshifted by the
    //      number of deleted rows

    this.each((ri, row) => {
      this.eachCells(ri, (ci, cell) => {
        const cellText = cell.getText();
        if (isFormula(cellText)) {
          // Adjust ranges
          let newCellText = cellText.replace(REGEX_EXPR_RANGE_GLOBAL, word => {
            const [rangeStart, rangeEnd] = word.split(':');
            const [rangeStartX, rangeStartY, rangeStartXIsAbsolute, rangeStartYIsAbsolute] = expr2xy(rangeStart);
            const [rangeEndX,   rangeEndY,   rangeEndXIsAbsolute,   rangeEndYIsAbsolute]   = expr2xy(rangeEnd);

            const isRangeStartInDeletedZone = (rangeStartY >= sri) && (rangeStartY <= eri);
            const isRangeEndInDeletedZone   = (rangeEndY   >= sri) && (rangeEndY   <= eri);

            if (isRangeStartInDeletedZone && isRangeEndInDeletedZone) {
              // Entire range is in deleted zone:
              // Return reference error
              return 'REF:REF';
            } else if (isRangeStartInDeletedZone) {
              // Just the start of the range is in the deleted zone:
              // Shift start of range past the end index of the deleted zone.
              const newRangeStart = xy2expr(rangeStartX, eri + 1, rangeStartXIsAbsolute, rangeStartYIsAbsolute);
              return `${newRangeStart}:${rangeEnd}`;
            } else if (isRangeEndInDeletedZone) {
              // Just the end of the range is in the deleted zone:
              // Shift end of the range before the start index of the deleted zone.
              // Note: sri - 1 will never be negative because if sri == 0 and isRangeEndInDeletedZone,
              // then isRangeStartInDeletedZone must also be true, returning 'REF:REF'.
              const newRangeEnd = xy2expr(rangeEndX, sri - 1, rangeEndXIsAbsolute, rangeEndYIsAbsolute);
              return `${rangeStart}:${newRangeEnd}`;
            }

            return word;
          });
          // Adjust single references (including start and end of ranges)
          newCellText = newCellText.replace(REGEX_EXPR_GLOBAL, word => {
            const [x, y, xIsAbsolute, yIsAbsolute] = expr2xy(word);

            if (y < sri) {
              // Reference is before deleted range, no change needed
              return word;
            } else if (y > eri) {
              // Reference is after deleted range, shift by n
              return xy2expr(x, y - n, xIsAbsolute, yIsAbsolute);
            }

            // Reference is in deleted range, return reference error
            return 'REF';
          });

          cell.setText(newCellText);
        }
      });
    });
  }

  insertColumn(sci, n = 1) {
    // Step 1: Update all rows (shift as needed).
    this.each((ri, row) => {
      const rndata = {};
      this.eachCells(ri, (ci, cell) => {
        let nci = parseInt(ci, 10);
        if (nci < sci) {
          // Column before insertion point:
          // Preserve column at same index as before
          rndata[nci] = cell;
        } else {
          // Column is at/after insertion point:
          // Move column to new index offset by number of columns inserted
          rndata[nci + n] = cell;
        }
      });

      row.cells = rndata;
    });

    // Step 2: For all cells which remain, make the following adjustments to
    // the cell references in their text string:
    // - Any reference after the insertion point must be rightshifted by the
    //   number of inserted columns
    this.each((ri, row) => {
      this.eachCells(ri, (ci, cell) => {
        const cellText = cell.getText();
        if (isFormula(cellText)) {
          cell.setText(
            cellText.replace(REGEX_EXPR_GLOBAL, word => expr2expr(word, n, 0, true, x => x >= sci))
          );
        }
      });
    });
  }

  deleteColumn(sci, eci) {
    const n = eci - sci + 1;

    // Step 1: Update all columns (delete or shift as needed) and cleanup
    // relationships to cells in deleted columns.
    this.each((ri, row) => {
      const rndata = {};
      this.eachCells(ri, (ci, cell) => {
        const nci = parseInt(ci, 10);
        if (nci < sci) {
          // Column is below deletion start index:
          // Preserve column at same index as before
          rndata[nci] = cell;
        } else if (nci > eci) {
          // Column is above deletion index:
          // Move row to new index offset by number of columns deleted
          rndata[nci - n] = cell;
        } else {
          // Column is in deletion range:
          // Remove the connection between all cells in these columns and the cells
          // they depend on.
          cell.uses.forEach((dependentCell) => dependentCell.noLongerUsedByCell(cell));
        }
      });
      row.cells = rndata;
    });

    // Step 2: For all cells which remain, make the following adjustments to
    // the cell references in their text string:
    // - Any reference in the deleted range should be replaced with 'REF',
    //   indicating a reference error
    // - Any reference above the deleted range must be leftshifted by the
    //   number of deleted columns
    this.each((ri, row) => {
      this.eachCells(ri, (ci, cell) => {
        const cellText = cell.getText();
        if (isFormula(cellText)) {
          // Adjust ranges
          let newCellText = cellText.replace(REGEX_EXPR_RANGE_GLOBAL, word => {
            const [rangeStart, rangeEnd] = word.split(':');
            const [rangeStartX, rangeStartY, rangeStartXIsAbsolute, rangeStartYIsAbsolute] = expr2xy(rangeStart);
            const [rangeEndX,   rangeEndY,   rangeEndXIsAbsolute,   rangeEndYIsAbsolute]   = expr2xy(rangeEnd);

            const isRangeStartInDeletedZone = (rangeStartX >= sci) && (rangeStartX <= eci);
            const isRangeEndInDeletedZone   = (rangeEndX   >= sci) && (rangeEndX   <= eci);

            if (isRangeStartInDeletedZone && isRangeEndInDeletedZone) {
              // Entire range is in deleted zone:
              // Return reference error
              return 'REF:REF';
            } else if (isRangeStartInDeletedZone) {
              // Just the start of the range is in the deleted zone:
              // Shift start of range past the end index of the deleted zone.
              const newRangeStart = xy2expr(eci + 1, rangeStartY, rangeStartXIsAbsolute, rangeStartYIsAbsolute);
              return `${newRangeStart}:${rangeEnd}`;
            } else if (isRangeEndInDeletedZone) {
              // Just the end of the range is in the deleted zone:
              // Shift end of the range before the start index of the deleted zone.
              // Note: sci - 1 will never be negative because if sci == 0 and isRangeEndInDeletedZone,
              // then isRangeStartInDeletedZone must also be true, returning 'REF:REF'.
              const newRangeEnd = xy2expr(sci - 1, rangeEndY, rangeEndXIsAbsolute, rangeEndYIsAbsolute);
              return `${rangeStart}:${newRangeEnd}`;
            }

            return word;
          });
          // Adjust single references (including start and end of ranges)
          newCellText = newCellText.replace(REGEX_EXPR_GLOBAL, word => {
            const [x, y, xIsAbsolute, yIsAbsolute] = expr2xy(word);

            if (x < sci) {
              // Reference is before deleted range, no change needed
              return word;
            } else if (x > eci) {
              // Reference is after deleted range, shift by n
              return xy2expr(x - n, y, xIsAbsolute, yIsAbsolute);
            }

            // Reference is in deleted range, return reference error
            return 'REF';
          });

          cell.setText(newCellText);
        }
      });
    });
  }

  // what: all | text | format | merge
  deleteCells(cellRange, what = 'all') {
    cellRange.each((i, j) => {
      this.deleteCell(i, j, what);
    });
  }

  // what: all | text | format | merge
  deleteCell(ri, ci, what = 'all') {
    const row = this.get(ri);
    if (row !== null) {
      const cell = this.getCell(ri, ci);
      if (cell && cell.isEditable()) {
        const shouldDelete = cell.delete(what);
        if (shouldDelete) delete row.cells[ci];
      }
    }
  }

  maxCell() {
    const keys = Object.keys(this._);
    const ri = keys[keys.length - 1];
    const col = this._[ri];
    if (col) {
      const { cells } = col;
      const ks = Object.keys(cells);
      const ci = ks[ks.length - 1];
      return [parseInt(ri, 10), parseInt(ci, 10)];
    }
    return [0, 0];
  }

  each(cb) {
    Object.entries(this._).forEach(([ri, row]) => {
      cb(ri, row);
    });
  }

  eachCells(ri, cb) {
    if (this._[ri] && this._[ri].cells) {
      Object.entries(this._[ri].cells).forEach(([ci, cell]) => {
        cb(ci, cell);
      });
    }
  }

  setData(d) {
    if (d.len) {
      this.len = d.len;
      delete d.len;
    }
    this._ = d;
  }

  getData() {
    const data = {};
    data.len = this.len;

    // Extract a copy of cell.state from the Cell objects, rather than
    // returning the full Cell. This both reduces data storage needs and avoids
    // any serialization problems with circular dependencies (which a Cell
    // object may contain in cell.uses and cell.usedBy).
    Object.entries(this._).forEach(([ri, row]) => {
      data[ri] = { cells: {} };

      Object.entries(row.cells).forEach(([ci, cell]) => {
        data[ri].cells[ci] = cell.getStateCopy();
      });
    });

    return data;
  }
}

export default {};
export {
  Rows,
};
