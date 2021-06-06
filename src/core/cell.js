const isFormula = (src) => {
  return src.length > 0 && src[0] === '=';
}

// formulaParser is a Parser object from the hot-formula-parser package
const cellRender = (src, formulaParser) => {
  // If cell contains a formula, recursively parse that formula to get the value
  if (isFormula(src)) {
    const parsedResult = formulaParser.parse(src.slice(1));
    const recursedSrc = (parsedResult.error) ?
            parsedResult.error :
            parsedResult.result;

    const parsedResultRecurse = cellRender(recursedSrc, formulaParser);
    return parsedResultRecurse;
  }

  // If cell doesn't contain a formula, render its content as is
  return src;
};

class Cell {
  constructor(dataProxy, properties) {
    this.value = null;

    if (dataProxy === undefined && properties === undefined)
      return;

    // Properties that may exist:
    // - text
    // - style
    // - merge
    // - editable
    this.set(dataProxy, properties);
  }

  setText(dataProxy, text) {
    if (!this.isEditable())
      return;

    this.text = text;
    // Call dataProxy, ask it to recalculate everything
  }

  set(dataProxy, fieldInfo, what = 'all') {
    if (!this.isEditable())
      return;

    if (what === 'all') {
      Object.keys(fieldInfo).forEach((fieldName) => {
        if (fieldName === 'text') {
          this.setText(dataProxy, fieldInfo.text);
        } else {
          this[fieldName] = fieldInfo[fieldName];
        }
      });
    } else if (what === 'text') {
      this.setText(dataProxy, fieldInfo.text);
    } else if (what === 'format') {
      this.style = fieldInfo.style;
      if (this.merge) this.merge = fieldInfo.merge;
    }
  }

  isEditable() {
    return this.editable !== false;
  }

  delete(dataProxy, what) {
    if (!this.isEditable())
      return;

    // Note: deleting the cell (what === 'all') needs to be handled at a
    // higher level (the row object).
    if (what === 'text') {
      if (this.text) delete this.text;
      if (this.value) delete this.value;
      // TODO!!: Call dataProxy to update values of dependencies
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

    return getText();
  }

  calculateValueFromText(formulaParser) {
    this.value = cellRender(this.text, formulaParser);
  }
}

export default {
  render: cellRender,
  Cell: Cell
};

export {
  Cell,
};
