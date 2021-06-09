import helper from './helper';
import { Cell } from './cell';
import { expr2expr, REGEX_EXPR_GLOBAL } from './alphabet';

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
    if (cell && cell.merge) return cell.merge;
    return [0, 0];
  }

  getCellOrNew(ri, ci) {
    const row = this.getOrNew(ri);

    if (row.cells[ci] === undefined) {
      row.cells[ci] = new Cell(ri, ci);
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
    const ndata = {};
    this.each((ri, row) => {
      let nri = parseInt(ri, 10);
      if (nri >= sri) {
        nri += n;
        this.eachCells(ri, (ci, cell) => {
          const cellText = cell.getText();
          if (cellText && cellText[0] === '=') {
            cell.setText(
              cellText.replace(REGEX_EXPR_GLOBAL, word => expr2expr(word, 0, n, true, (x, y) => y >= sri))
            );
          }
        });
      }
      ndata[nri] = row;
    });
    this._ = ndata;
    this.len += n;
  }

  delete(sri, eri) {
    const n = eri - sri + 1;
    const ndata = {};
    this.each((ri, row) => {
      const nri = parseInt(ri, 10);
      if (nri < sri) {
        ndata[nri] = row;
      } else if (ri > eri) {
        ndata[nri - n] = row;
        this.eachCells(ri, (ci, cell) => {
          const cellText = cell.getText();
          if (cellText && cellText[0] === '=') {
            cell.setText(
              cellText.replace(REGEX_EXPR_GLOBAL, word => expr2expr(word, 0, -n, true, (x, y) => y > eri))
            );
          }
        });
      }
    });
    this._ = ndata;
    this.len -= n;
  }

  insertColumn(sci, n = 1) {
    this.each((ri, row) => {
      const rndata = {};
      this.eachCells(ri, (ci, cell) => {
        let nci = parseInt(ci, 10);
        if (nci >= sci) {
          nci += n;
          const cellText = cell.getText();
          if (cellText && cellText[0] === '=') {
            cell.setText(
              cellText.replace(REGEX_EXPR_GLOBAL, word => expr2expr(word, n, 0, true, x => x >= sci))
            );
          }
        }
        rndata[nci] = cell;
      });
      row.cells = rndata;
    });
  }

  deleteColumn(sci, eci) {
    const n = eci - sci + 1;
    this.each((ri, row) => {
      const rndata = {};
      this.eachCells(ri, (ci, cell) => {
        const nci = parseInt(ci, 10);
        if (nci < sci) {
          rndata[nci] = cell;
        } else if (nci > eci) {
          rndata[nci - n] = cell;
          const cellText = cell.getText();
          if (cellText && cellText[0] === '=') {
            cell.setText(
              cellText.replace(REGEX_EXPR_GLOBAL, word => expr2expr(word, -n, 0, true, x => x > eci))
            );
          }
        }
      });
      row.cells = rndata;
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

  updateCellValues() {
    // this.each((ri) => {
    //   this.eachCells(ri, (ci, cell) => {
    //     cell.calculateValueFromText();
    //   });
    // });
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
