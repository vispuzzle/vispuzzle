/**
 * Data JSONization module: convert internal data formats into a standard JSON format.
 */

function buildCategoryColorMap(chart) {
  const categories =
    Array.isArray(chart?.config?.order) && chart.config.order.length
      ? chart.config.order
      : chart?.X?.data?.[0];
  const colorAccessor = chart?.config?.color;

  if (!Array.isArray(categories) || categories.length === 0 || !colorAccessor) {
    return null;
  }

  const colorMap = new Map();
  categories.forEach((category) => {
    let color = null;
    if (typeof colorAccessor === "function") {
      color = colorAccessor(category);
    } else if (typeof colorAccessor === "string") {
      color = colorAccessor;
    }
    if (color) {
      colorMap.set(String(category), String(color));
    }
  });

  return colorMap.size > 0 ? colorMap : null;
}

function applyRegisteredColorsToSavedSvg(parsedSvg, chart) {
  if (!chart?.chartType?.endsWith("bar")) return;

  const categoryColorMap = buildCategoryColorMap(chart);
  if (!categoryColorMap) return;

  const orderedCategories =
    (Array.isArray(chart?.config?.order) && chart.config.order.length
      ? chart.config.order
      : chart?.X?.data?.[0]) || [];

  const barGroups = parsedSvg.querySelectorAll(".bar-group");
  barGroups.forEach((group, index) => {
    const labelElement = group.querySelector(".line-text");
    const category =
      labelElement?.textContent?.trim() ||
      String(orderedCategories[index] || "");
    const color = categoryColorMap.get(category);
    if (!color) return;

    group.querySelectorAll("rect").forEach((element) => {
      element.setAttribute("fill", color);
    });
    group.querySelectorAll(".extended-path").forEach((element) => {
      element.setAttribute("fill", color);
    });
    group.querySelectorAll(".gradient-line").forEach((element) => {
      element.setAttribute("stroke", color);
      element.setAttribute("stroke-opacity", "0.7");
    });
  });

  parsedSvg.querySelectorAll(".anchor-reference-point").forEach((anchor) => {
    const category = anchor.getAttribute("data-category");
    const color = category ? categoryColorMap.get(category) : null;
    if (color) {
      anchor.setAttribute("data-color", color);
    }
  });
}

/**
 * Infer the data type.
 *
 * @param {Array} data - Data array.
 * @returns {string} - Data type: 'numerical', 'categorical', 'temporal'
 */
function inferDataType(data) {
  if (!data || data.length === 0) return "categorical";

  // Check whether all items are numbers.
  const allNumbers = data.every(
    (item) =>
      (typeof item === "number" && !isNaN(item)) ||
      (typeof item === "string" && !isNaN(Number(item))),
  );
  if (allNumbers) return "numerical";

  // Check whether all items are date strings.
  const datePattern =
    /^\d{4}[-/](0?[1-9]|1[012])[-/](0?[1-9]|[12][0-9]|3[01])$/;
  const allDates = data.every(
    (item) =>
      typeof item === "string" &&
      (datePattern.test(item) || !isNaN(Date.parse(item))),
  );
  if (allDates) return "temporal";

  // Booleans and all other types are treated as categorical.
  return "categorical";
}

/**
 * Convert internal data into JSON format.
 *
 * @param {Object} data - Raw data object.
 * @param {Object} options - Conversion options.
 * @param {string} options.title - Chart title.
 * @param {string} options.description - Chart description.
 * @param {string} options.mainInsight - Main insight.
 * @returns {Object} Data in JSON format.
 */
export function jsonizeData(data, options = {}) {
  const defaults = {
    title: "Data Visualization Chart",
    description: "Data visualization result display",
    mainInsight: "Key insights from the data",
  };

  const metadata = {
    ...defaults,
    ...options,
    chart_type: data.chartType || "unknown",
  };
  const defaultColors = {
    colors: {
      field: {},
      other: {
        primary: "#4E79A7",
        secondary: "#F28E2B",
        background: "#F7F7F7",
      },
      available_colors: [
        "#4E79A7",
        "#F28E2B",
        "#E15759",
        "#76B7B2",
        "#59A14F",
        "#EDC948",
      ],
      text_color: "#333333",
      background_color: "#F7F7F7",
    },
    colors_dark: {
      field: {},
      other: {
        primary: "#7FB3FF",
        secondary: "#FFB86B",
        background: "#0F1720",
      },
      available_colors: [
        "#7FB3FF",
        "#FFB86B",
        "#FF7A7A",
        "#7FD6CF",
        "#7BC96F",
        "#FFE082",
      ],
      text_color: "#FFFFFF",
      background_color: "#0F1720",
    },
    images: {
      field: {},
      other: {},
    },
  };
  if (!data || !data.X || !data.Y) {
    return null;
  }

  const xData = data.X.data[0] || [];

  // Check whether there are multiple Y series (based on label).
  const hasMultipleGroups =
    data.Y && data.Y.data && data.Y.data.length > 1 && data.Y.label;
  // Prepare columns.
  const columns = [];

  // Infer the data type of X.
  const xDataType = inferDataType(xData);

  // Add the X column - always first.
  columns.push({
    name: data.X.name || "Category",
    importance: "primary",
    description: `${data.X.name || "Category"} data`,
    data_type: xDataType,
    unit: "none",
    role: "x", // X-axis data
  });

  // Add the Y column - always second.
  if (hasMultipleGroups) {
    // Handle multiple Y series (Y.label form).
    columns.push({
      name: data.Y.name || "Value",
      importance: "primary",
      description: `${data.Y.name || "Value"} data`,
      data_type: "numerical",
      unit: "none",
      role: "y", // Y-axis data
    });
  } else {
    // Handle the standard Y series.
    if (!data.Y || !data.Y.data || data.Y.data.length === 0) {
      return;
    }
    const yData = data.Y.data[0] || [];
    const yDataType = inferDataType(yData);

    columns.push({
      name: data.Y.name || "Value",
      importance: "primary",
      description: `${data.Y.name || "Value"} data`,
      data_type: yDataType,
      unit: "none",
      role: "y", // Y-axis data
    });
  }

  // Check whether Y2 exists - if so, place it third.
  if (data.Y2 && data.Y2.data && data.Y2.data.length > 0) {
    const y2Data = data.Y2.data[0] || [];
    const y2DataType = inferDataType(y2Data);

    columns.push({
      name: data.Y2.name || "Value2",
      importance: "secondary",
      description: `${data.Y2.name || "Value2"} data`,
      data_type: y2DataType,
      unit: "none",
      role: "y2", // Second Y-axis data
    });
  }

  // If there are multiple series, add the group column - place it last.
  if (hasMultipleGroups) {
    const yLabels = data.Y.label || [];
    const groupName = data.Y.label_name || "group";

    columns.push({
      name: groupName,
      importance: "primary",
      description: `${groupName} data`,
      data_type: "categorical",
      unit: "none",
      role: "group", // Grouping data
    });
  }

  // Build type_combination according to the columns order (x, y, y2, group).
  // Extract data types from columns and join them in order.
  const dataTypes = columns.map((col) => col.data_type);
  const type_combination = dataTypes.join(" + ");

  // Build the converted data structure.
  const formattedData = {
    description: metadata.description,
    data: {
      data: [],
      columns: columns,
      type_combination: type_combination,
    },
    metadata: {
      title: metadata.title,
      description: metadata.description,
      main_insight: metadata.mainInsight,
      chart_type: metadata.chart_type,
    },
    ...defaultColors,
  }; // Data payload
  if (hasMultipleGroups) {
    // Handle multiple Y series (Y.label form).
    const ySeriesData = data.Y.data;
    const yLabels = data.Y.label || [];
    const groupName = data.Y.label_name || "group";
    const valueName = data.Y.name || "Value";

    // For each X value, emit records for all groups.
    for (let i = 0; i < xData.length; i++) {
      // Create one record per group.
      for (let j = 0; j < ySeriesData.length; j++) {
        if (j < yLabels.length && i < ySeriesData[j].length) {
          const entry = {};

          // Add fields in order: x, y, y2, group.

          // 1) X
          entry[data.X.name || "Category"] = xData[i];

          // 2) Y
          entry[valueName] = ySeriesData[j][i];

          // 3) Y2 (if present)
          if (data.Y2 && data.Y2.data && data.Y2.data.length > 0) {
            const y2Data = data.Y2.data[0] || [];
            if (i < y2Data.length) {
              entry[data.Y2.name || "Value2"] = y2Data[i];
            }
          }

          // 4) Group label
          entry[groupName] = yLabels[j];

          formattedData.data.data.push(entry);
        }
      }
    }
  } else {
    // Handle the standard format.
    const maxLength = xData.length;
    const yData = data.Y.data[0] || [];

    for (let i = 0; i < maxLength; i++) {
      const entry = {};

      // X
      if (i < xData.length) {
        entry[data.X.name || "Category"] = xData[i];
      }

      // Y
      if (i < yData.length) {
        entry[data.Y.name || "Value"] = yData[i];
      }

      // Y2 (if present)
      if (data.Y2 && data.Y2.data && data.Y2.data.length > 0) {
        const y2Data = data.Y2.data[0] || [];
        if (i < y2Data.length) {
          entry[data.Y2.name || "Value2"] = y2Data[i];
        }
      }

      formattedData.data.data.push(entry);
    }
  }

  // Preserve the original data.
  formattedData.originalData = data;

  return formattedData;
}

export async function loadNodeModule(moduleName) {
  const isNode =
    typeof window === "undefined" || typeof window.document === "undefined";

  if (!isNode) {
    return null;
  }
  try {
    const module = await import(/* @vite-ignore */ moduleName);
    return module.default || module;
  } catch (e) {
    console.error(`Failed to load module ${moduleName}:`, e.message);
    return null;
  }
}

export async function saveJsonizedData(jsonizedData, _templateName = null) {
  debugger;
  // console.log("jsonizedData:", jsonizedData);
  try {
    const dataToSave = JSON.parse(
      JSON.stringify({
        description: jsonizedData.description,
        data: jsonizedData.data,
        metadata: jsonizedData.metadata,
      }),
    );
    const scale = Math.max(
      600 / jsonizedData.originalData.config.width,
      600 / jsonizedData.originalData.config.height,
    );
    dataToSave.variables = {
      width: jsonizedData.originalData.config.width * scale,
      height: jsonizedData.originalData.config.height * scale,
      has_rounded_corners: false,
      has_shadow: false,
      has_spacing: false,
      has_gradient: false,
      has_stroke: false,
    };
    console.log("dataToSave:", dataToSave);
    // Use a hash of the data to uniquely identify this payload.
    const crypto = await loadNodeModule("crypto");
    const dataHash = crypto
      .createHash("md5")
      .update(JSON.stringify(dataToSave))
      .digest("hex")
      .substring(0, 12); // Use the first 12 chars as a short identifier

    const filename = `jsonized-data-${dataHash}.json`;
    let svgPath = null; // Store the generated SVG path

    const isNode =
      typeof window === "undefined" || typeof window.document === "undefined";

    if (isNode) {
      const fs = await loadNodeModule("fs");
      const path = await loadNodeModule("path");
      const { exec } = await loadNodeModule("child_process");
      const util = await loadNodeModule("util");

      if (fs && path) {
        try {
          const tempDataDir = path.join(process.cwd(), "temp_data");
          if (!fs.existsSync(tempDataDir)) {
            fs.mkdirSync(tempDataDir, { recursive: true });
          }

          const runOutputDir = path.join(tempDataDir, `run_${dataHash}`);

          const alreadyExists = fs.existsSync(runOutputDir);
          const processedDataPath = path.join(
            runOutputDir,
            "processed_data.json",
          );
          const chartOutputPath = path.join(
            runOutputDir,
            `chart_${dataHash}.svg`,
          );
          const chartInfoPath = path.join(runOutputDir, `chart.info`);
          // Update SVG path
          svgPath = chartOutputPath;

          if (
            alreadyExists &&
            fs.existsSync(processedDataPath) &&
            fs.existsSync(chartOutputPath)
          ) {
            console.log(
              `Found existing processed result; reusing previous output: ${chartOutputPath}`,
            );
            // Read existing output data for returning.
            try {
              const savedData = JSON.parse(
                fs.readFileSync(path.join(runOutputDir, filename), "utf8"),
              );
              // Read the generated SVG content.
              const svgContent = fs.readFileSync(chartOutputPath, "utf8");
              const chartInfoContent = JSON.parse(
                fs.readFileSync(chartInfoPath, "utf8"),
              );
              console.log(
                `Read existing chart info: ${chartInfoContent.chart_name}`,
              );
              savedData.svgContent = svgContent; // Attach SVG content to the returned data
              savedData.svgPath = chartOutputPath; // Attach SVG path
              savedData.chart_name = chartInfoContent.chart_name;
              return savedData;
            } catch (readError) {
              console.warn(
                `Error reading existing result: ${readError.message}; will reprocess data`,
              );
              // Continue with subsequent processing.
            }
          }

          if (!alreadyExists) {
            fs.mkdirSync(runOutputDir, { recursive: true });
          }

          const filePath = path.join(runOutputDir, filename);

          if (
            dataToSave &&
            dataToSave.metadata &&
            dataToSave.metadata.chart_type
          ) {
            throw new Error(
              `Not implemented`
            );
          }
        } catch (fileError) {
          console.error(fileError.stack);
        }
      }
    }

    // console.log("Saved JSON data:", dataToSave);
    return dataToSave; // Return the data for further processing by the caller
  } catch (error) {
    console.error("Error while processing JSON data:", error);
    console.error(error.stack);
    throw error; // Rethrow so the caller can handle it
  }
}

async function loadSvgLibs() {
  const svgJs = await loadNodeModule("@svgdotjs/svg.js");
  const svgdom = await loadNodeModule("svgdom");
  return {
    SVG: svgJs?.SVG,
    registerWindow: svgJs?.registerWindow,
    createSVGWindow: svgdom?.createSVGWindow,
  };
}

/**
 * Replace the chart layer contents with a generated SVG chart.
 *
 * @param {Object} g - The layer element (D3 selection).
 * @param {Object} savedResult - The saved result containing SVG content.
 * @param {Object} document - DOM document object.
 * @param {Object} config - Config object { x, y, width, height }.
 * @returns {boolean} - Whether the replacement succeeded.
 */
export async function replaceSvgContent(g, savedResult, document, chart = {}) {
  if (
    !savedResult?.svgContent ||
    savedResult.svgContent.includes(
      "This is a fallback SVG using a PNG screenshot",
    )
  ) {
    return false;
  }

  try {
    const chartLayer = g.node();

    // Parse the SVG content.
    const tempContainer = document.createElement("div");
    tempContainer.innerHTML = savedResult.svgContent;
    const parsedSvg = tempContainer.querySelector("svg");

    if (!parsedSvg) {
      console.warn("Cannot parse svg");
      return false;
    }

    applyRegisteredColorsToSavedSvg(parsedSvg, chart);

    // Fix font-size: convert all font-size values to the nearest integer.
    const elementsWithFontSize = parsedSvg.querySelectorAll(
      '*[font-size], *[style*="font-size"]',
    );
    elementsWithFontSize.forEach((element) => {
      // Handle the font-size attribute.
      if (element.hasAttribute("font-size")) {
        const fontSize = parseFloat(element.getAttribute("font-size"));
        if (!isNaN(fontSize)) {
          element.setAttribute("font-size", Math.round(fontSize).toString());
        }
      }

      // Handle font-size in the style attribute.
      if (element.hasAttribute("style")) {
        const style = element.getAttribute("style");
        const updatedStyle = style.replace(
          /font-size:\s*([0-9.]+)/g,
          (match, size) => {
            const fontSize = parseFloat(size);
            return `font-size: ${Math.round(fontSize)}`;
          },
        );
        element.setAttribute("style", updatedStyle);
      }
    });

    const { SVG, registerWindow, createSVGWindow } = await loadSvgLibs();

    // Get bbox via SVG.js.
    const window = createSVGWindow();
    registerWindow(window, window.document);

    const draw = SVG(window.document.documentElement);
    draw.svg(parsedSvg.outerHTML);
    const svg = draw.findOne("svg") || draw;

    // Get bbox for the whole SVG.
    let svgBBox;
    try {
      svgBBox = svg.bbox();
    } catch (error) {
      console.warn("Error getting SVG bounding box:", error.message);
      svgBBox = { x: 0, y: 0, width: 100, height: 100 }; // Fallback default
    }

    // Read target position and size from config.
    const {
      left: targetX = 0,
      top: targetY = 0,
      width: targetWidth = svgBBox.width,
      height: targetHeight = svgBBox.height,
    } = chart.config || {};

    // Compute scale.
    let scaleX = targetWidth / svgBBox.width;
    let scaleY = targetHeight / svgBBox.height;
    scaleX = Math.max(scaleX, scaleY); // Preserve aspect ratio
    scaleY = scaleX; // Preserve aspect ratio
    console.log(`Target: (${targetX}, ${targetY})`);
    console.log(`Scale factors: scaleX=${scaleX}, scaleY=${scaleY}`);
    console.log(`Original size: ${svgBBox.width} x ${svgBBox.height}`);
    console.log(`Target size: ${targetWidth} x ${targetHeight}`);

    // Replace layer contents.
    while (chartLayer.firstChild) {
      chartLayer.removeChild(chartLayer.firstChild);
    }

    // Create a wrapper group to apply transforms.
    const wrapperGroup = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "g",
    );

    // Compute transform: scale to target size, then translate to target position.
    // Account for the original SVG content offset.
    const translateX = targetX - svgBBox.x * scaleX;
    const translateY = targetY - svgBBox.y * scaleY;

    // Apply combined transform: translate + scale.
    const transform = `translate(${translateX}, ${translateY}) scale(${scaleX}, ${scaleY})`;
    wrapperGroup.setAttribute("transform", transform);

    // Move original SVG children into the wrapper group.
    while (parsedSvg.firstChild) {
      wrapperGroup.appendChild(parsedSvg.firstChild);
    }

    // Append the wrapper group to the chart layer.
    chartLayer.appendChild(wrapperGroup);

    // Clear the original transform and use the new precise positioning.
    g.attr("transform", null);

    g.attr("data-replaced", "true");

    // Find all elements with class anchor-reference-point.
    const anchorPoints = wrapperGroup.querySelectorAll(
      ".anchor-reference-point",
    );

    // Return structure similar to processBasicChart.
    let labelPositions = {};
    let labelColor = {};
    if (anchorPoints.length > 0) {
      const anchorPositions = [];

      anchorPoints.forEach((anchor, index) => {
        // Extract element position and data attributes.
        const cx = parseFloat(anchor.getAttribute("cx") || 0);
        const cy = parseFloat(anchor.getAttribute("cy") || 0);
        const anchorType = anchor.getAttribute("data-anchor-type");
        const category = anchor.getAttribute("data-category");
        // Extract color, preferring data-color; otherwise fall back to fill or stroke.
        const color =
          anchor.getAttribute("data-color") ||
          (anchor.getAttribute("fill") !== "transparent"
            ? anchor.getAttribute("fill")
            : anchor.getAttribute("stroke"));

        // Compute the actual position (after scaling and translation).
        const actualX = cx * scaleX + translateX;
        const actualY = cy * scaleY + translateY;

        // Collect anchor information.
        const anchorInfo = {
          index,
          id: anchor.id || `anchor-${index}`,
          originalPosition: { cx, cy },
          transformedPosition: { x: actualX, y: actualY },
          anchorType,
          category,
          color, // Attach color information
          element: anchor,
        };

        anchorPositions.push(anchorInfo);

        // TMP: Use bottom-type anchors to build labelPosition.
        if (category) {
          if (labelPositions[anchorType] === undefined) {
            labelPositions[anchorType] = {};
          }
          // Store position info keyed by category in labelPosition.
          labelPositions[anchorType][category] = {
            x: actualX - targetX,
            y: actualY - targetY,
            // x/y are offsets relative to the target position
          };
          labelColor[category] = color; // Store color info
        }
      });

      // Attach anchor position info onto the g element for later use.
      g.attr(
        "data-anchor-points",
        JSON.stringify(
          anchorPositions.map((ap) => ({
            index: ap.index,
            id: ap.id,
            originalPosition: ap.originalPosition,
            transformedPosition: ap.transformedPosition,
            anchorType: ap.anchorType,
            category: ap.category,
            color: ap.color,
          })),
        ),
      );
    }

    console.log("labelPositions, targetX, targetY, labelColor:", {
      labelPositions,
      targetX,
      targetY,
      labelColor,
    });
    return [labelPositions, targetX, targetY, labelColor];
  } catch (error) {
    console.error("Error when processing SVG:", error);
    return false;
  }
}
