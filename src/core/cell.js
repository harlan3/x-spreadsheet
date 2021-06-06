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
  constructor(properties) {
    this.value = null;

    // Properties that may exist:
    // - text
    // - style
    // - merge
    // - editable
    Object.assign(this, properties);
  }

  setText(dataProxy, text) {
    this.text = text;
    // Call dataProxy, ask it to recalculate everything
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
