// This file manages the palette of colors used in the charts, and how to bind colors with data.

import * as d3 from "d3";
import chroma from "chroma-js";

const mainColors = [
  "#b95753",
  "#6b7a94",
  "#86a073",
  "#bfac42",
  "#ce7a53",
  "#688d8d",
  "#8c5c5a",
  "#d1a054",
  "#a06b5a",
  "#5c5f4e",
];
const defaultBaseColor = "#2d6a4f";

function generateColorScale(n, baseColor) {
  if (!chroma.valid(baseColor)) {
    const initialPalette = chroma.scale("spectral").mode("lch").colors(n);

    const correctedPalette = initialPalette.map((colorStr) => {
      const minContrast = 4.5;
      let color = chroma(colorStr);
      let safetyLock = 0; // prevent infinite loop

      // check contrast with white, if too low (color too light), darken it
      while (chroma.contrast(color, "white") < minContrast && safetyLock < 20) {
        color = color.darken(0.1);
        safetyLock++;
      }

      // check contrast with black, if too low (color too dark), brighten it
      safetyLock = 0;
      while (chroma.contrast(color, "black") < minContrast && safetyLock < 20) {
        color = color.brighten(0.1);
        safetyLock++;
      }

      return color.hex();
    });

    return correctedPalette;
  }

  const startColor = chroma(baseColor).set("lch.h", "-120");
  const endColor = chroma(baseColor).set("lch.h", "+120");

  const scale = chroma.scale([startColor, baseColor, endColor]).mode("lch");
  return scale.colors(n);
}

class Palette {
  constructor() {
    this.colorPalette = mainColors;
    this.baseColor = this.colorPalette[0];
    this.colorMaps = new Map();
    this.colorEncodingName = null; // the column name for color encoding
    this.colorEncodingValues = new Set(); // the values for color encoding
    this.nameValueCount = new Map(); // Map<name, { count: number, values: Set }>
  }

  clear() {
    this.colorMaps.clear();
    this.colorEncodingName = null;
    this.colorEncodingValues.clear();
    this.nameValueCount.clear();
  }

  setMainColor(mainColor) {
    mainColor = mainColor.filter((d) => d !== this.baseColor);
    this.colorPalette = mainColor;
  }

  setBaseColor(baseColor) {
    this.baseColor = baseColor;
  }

  randomColor() {
    const randomIndex = Math.floor(Math.random() * this.colorPalette.length);
    return this.colorPalette[randomIndex];
  }

  registerColorMap(name, values, force, count) {
    if (force) {
      if (this.colorEncodingName) {
        // already has some color encoding
        if (this.colorEncodingName === name) {
          // same name, update values
          values.forEach((value) => {
            this.colorEncodingValues.add(value);
          });
        } else {
          // different name, not allowed
          throw new Error(
            `Color encoding name "${name}" is different from existing name "${this.colorEncodingName}".`,
          );
        }
      } else {
        // no color encoding yet
        this.colorEncodingName = name;
        values.forEach((value) => {
          this.colorEncodingValues.add(value);
        });
      }
    } else {
      // record the count and values for each name
      if (!this.nameValueCount.has(name)) {
        this.nameValueCount.set(name, { count: 0, values: new Set() });
      }
      const entry = this.nameValueCount.get(name);
      entry.count += count;
      values.forEach((value) => {
        entry.values.add(value);
      });
    }
  }

  assignColorMaps() {
    // if no color encoding yet, choose the name with the most counts
    if (!this.colorEncodingName) {
      let maxName = null;
      let maxCount = -1;
      for (const [name, entry] of this.nameValueCount.entries()) {
        if (entry.count > maxCount) {
          maxCount = entry.count;
          maxName = name;
        }
      }
      this.colorEncodingName = maxName;
      this.colorEncodingValues = new Set();
      if (maxName) {
        for (const value of this.nameValueCount.get(maxName).values) {
          this.colorEncodingValues.add(value);
        }
      }
    }

    // handle the case when colorEncodingValues is more than colorPalette
    if (this.colorEncodingValues.size > this.colorPalette.length) {
      // select a palette with enough colors
      const baseColor = defaultBaseColor;
      const mainColors = generateColorScale(this.colorEncodingValues.size + 2);

      this.setBaseColor(baseColor);
      this.setMainColor(mainColors);
    }

    this.colorMaps.set("base", (_) => {
      return this.baseColor;
    });

    if (
      this.colorEncodingName &&
      ["gender", "sex"].includes(this.colorEncodingName.toLowerCase())
    ) {
      const colors = new Map();
      for (const value of this.colorEncodingValues) {
        const lowerValue = String(value).toLowerCase();
        if (["male", "man", "boy", "m"].includes(lowerValue)) {
          colors.set(value, "#5da5da"); // Blue
        } else if (["female", "woman", "girl", "f"].includes(lowerValue)) {
          colors.set(value, "#f17cb0"); // Pink
        } else {
          colors.set(value, "#b276b2"); // Fallback
        }
      }
      this.colorMaps.set(this.colorEncodingName, function (value) {
        return colors.get(value);
      });
      return;
    }

    let colorIndex = 0;
    const colors = new Map();
    for (const value of this.colorEncodingValues) {
      colors.set(value, this.colorPalette[colorIndex]);
      if (colorIndex >= this.colorPalette.length) {
        throw new Error(
          "Not enough colors in the palette. Please add more colors.",
        );
      }
      colorIndex++;
    }
    this.colorMaps.set(this.colorEncodingName, function (value) {
      return colors.get(value);
    });
  }

  getColorMap(columnName) {
    if (columnName === this.colorEncodingName) {
      return [this.colorMaps.get(columnName), "encoding"];
    } else {
      return [this.colorMaps.get("base"), "base"];
    }
  }

  getMajorColors() {
    if (this.colorEncodingName) {
      const colorMap = this.colorMaps.get(this.colorEncodingName);
      const values = Array.from(this.colorEncodingValues);
      const colorScale = d3
        .scaleOrdinal()
        .domain(values)
        .range(values.map(colorMap));
      return colorScale;
    } else {
      return null;
    }
  }

  getMajorColorName() {
    if (this.colorEncodingName) {
      return (
        this.colorEncodingName.charAt(0).toUpperCase() +
        this.colorEncodingName.slice(1).toLowerCase()
      );
    } else {
      return null;
    }
  }
}

// In case we need to support hierarchical color mapping.
// Deprecated for now.
class HierarchicalPalette {
  constructor(numColors = 15, numRepeats = 10) {
    this.colorPalette = mainColors.map((baseColor) => {
      const interpolator = d3.interpolateHsl(
        baseColor,
        d3.hsl(baseColor).brighter(1),
      );
      return d3.quantize(interpolator, numColors);
    });
    this.colorPalette = [].concat(...Array(numRepeats).fill(this.colorPalette)); // naive approach to avoid not enough colors

    this.colorMaps = new Map();
    this.resetColorTree();
  }

  // Helper function to reset the color tree
  resetColorTree() {
    this.colorTree = {
      root: {
        children: [
          {
            name: "base",
            type: "base", // Avoid conflict with column names
            children: [],
            values: ["base"],
          },
        ],
      },
    };
  }

  clear() {
    this.resetColorTree();
    this.colorMaps.clear();
  }

  /*
   * Given a list of columns (each column has a name and a list of values),
   * register a hierarchical color map.
   * E.g. columns = [
   *   { name: "column1", values: ["A", "B", "C"] },
   *   { name: "column2", values: ["a", "b", "c"] },
   * ]
   **/
  registerColorMap(columns) {
    if (columns.length < 1 || columns.length > 2) {
      console.error("columns should be an array with 1 or 2 elements.");
      return;
    }

    const [majorColumn, minorColumn] = columns;

    // Step1: handle major column
    let majorNode = this.colorTree.root.children.find(
      (child) => child.name === majorColumn.name && child.type !== "base",
    );

    // TODO: potential bug here.
    // if majorNode.values !== majorColumn.values,
    // we need to merge the values.

    if (!majorNode) {
      this.colorTree.root.children.push({
        name: majorColumn.name,
        type: "major",
        children: [],
        values: majorColumn.values,
      });
    }

    majorNode = this.colorTree.root.children.find(
      (child) => child.name === majorColumn.name && child.type === "major",
    );

    // Step2: handle minor column
    if (minorColumn) {
      const minorNode = majorNode.children.find(
        (child) => child.name === minorColumn.name && child.type === "minor",
      );

      if (!minorNode) {
        majorNode.children.push({
          name: minorColumn.name,
          type: "minor",
          children: [],
          values: minorColumn.values,
        });
      }
    }
  }

  /*
   * After registering all color maps,
   * call this function to assign colors to each column.
   **/
  assignColorMaps() {
    let baseColorIndex = 0;
    let minorColorIndex = new Array(this.colorPalette.length).fill(0);

    for (const node of this.colorTree.root.children) {
      // base color (default color for all charts)
      if (node.type === "base") {
        const color =
          this.colorPalette[baseColorIndex][minorColorIndex[baseColorIndex]];
        minorColorIndex[baseColorIndex]++;
        baseColorIndex++;
        this.colorMaps.set(
          "base_base",
          function (majorValue = null, minorValue = null) {
            return color;
          },
        );
      } else if (node.type === "major") {
        // handle base color for each major value
        const colors = new Map();
        let currentBaseColorIndex = baseColorIndex;
        for (const value of node.values) {
          const color =
            this.colorPalette[currentBaseColorIndex][
              minorColorIndex[currentBaseColorIndex]
            ];
          minorColorIndex[currentBaseColorIndex]++;
          colors.set(value, color);
          currentBaseColorIndex++;
        }
        this.colorMaps.set(
          `${node.name}_major`,
          function (majorValue, minorValue = null) {
            return colors.get(majorValue);
          },
        );

        // handle minor colors for each major value
        for (const child of node.children) {
          const minorColors = new Map();
          let currentBaseColorIndex = baseColorIndex;
          for (const majorValue of node.values) {
            for (const minorValue of child.values) {
              const color =
                this.colorPalette[currentBaseColorIndex][
                  minorColorIndex[currentBaseColorIndex]
                ];
              minorColorIndex[currentBaseColorIndex]++;
              minorColors.set(`${majorValue}_${minorValue}`, color);
            }
            currentBaseColorIndex++;
          }
          this.colorMaps.set(
            `${node.name}_${child.name}_hierarchical`,
            function (majorValue, minorValue) {
              return minorColors.get(`${majorValue}_${minorValue}`);
            },
          );
        }

        baseColorIndex += node.values.length;
      } else {
        throw new Error("Invalid node type");
      }
    }
  }

  /*
   * Given a list of column names, return a color map function `colorMap()`.
   * The returned function `colorMap` which takes 2 arguments:
   * 1. a major value (default to be null)
   * 2. a minor value (default to be null)
   *
   * if both arguments are null, the function will return the base (default) color.
   * if only the major value is provided, the function will return the base color for the major value.
   * if both the major and minor values are provided, the function will return the hierarchical color for the major and minor values.
   **/
  getColorMap(columns) {
    let colorMap = null;
    if (!columns || columns.length === 0) {
      colorMap = this.colorMaps.get("base_base");
    } else if (columns.length === 1) {
      colorMap = this.colorMaps.get(`${columns[0]}_major`);
    } else if (columns.length === 2) {
      colorMap = this.colorMaps.get(`${columns[0]}_${columns[1]}_hierarchical`);
    } else {
      throw new Error(
        "Only one or two columns are supported for color mapping",
      );
    }
    if (!colorMap) {
      throw new Error("No color map found for columns: " + columns.join(" + "));
    }
    return colorMap;
  }

  /*
   * Return a map. Each key is a column name, and its value is d3.colorScale.
   *
   **/
  getMajorColors() {
    const majorColors = new Map();
    console.log(this.colorTree);
    for (const child of this.colorTree.root.children) {
      if (child.type === "major") {
        const colorScale = d3
          .scaleOrdinal()
          .domain(child.values)
          .range(child.values.map(this.getColorMap([child.name])));
        majorColors.set(child.name, colorScale);
      }
    }
    return majorColors;
  }
}

export default Palette;
