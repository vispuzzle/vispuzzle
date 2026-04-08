// This file provides the mapping from chart types to templates.
// It maps a chart type to a list of possible templates.

import { extractChartType } from "./node.js";

/**
 * Return the matching template list for a given chart type.
 * @param {string} chartType - Chart type, e.g. "vbar", "hscatter", "rpie", etc.
 * @returns {Array} - A list of matching templates.
 */
export function getTemplatesForChartType(chartType) {
  // Parse the chart type using extractChartType.
  const [orientation, aggregation, basicType] = extractChartType(chartType);

  // Find matching templates based on orientation, aggregation, and basicType.
  return findTemplatesByPattern(orientation, aggregation, basicType);
}

/**
 * Find matching templates by orientation, aggregation, and basic type.
 * @param {string} orientation - Orientation (v: vertical, h: horizontal, r: radial, c: circular)
 * @param {string} aggregation - Aggregation mode (s: stacked, g: grouped, empty: normal)
 * @param {string} basicType - Basic chart type (bar, line, scatter, pie, etc.)
 * @returns {Array} - A list of matching templates.
 */
function findTemplatesByPattern(orientation, aggregation, basicType) {
  // Full mapping of all templates.
  const templateMapping = {
    // Bar charts (Bar Chart)
    vbar: [
      "vertical bar chart",
      "histogram", // Special case: a histogram is also a vertical bar chart
    ],
    hbar: ["horizontal bar chart"],
    vsbar: ["vertical stacked bar chart"],
    hsbar: ["horizontal stacked bar chart"],
    vgbar: ["vertical group bar chart", "vertical grouped bar chart"],
    hgbar: ["horizontal group bar chart", "horizontal grouped bar chart"],
    rbar: ["radial bar chart"],
    rsbar: ["radial stacked bar chart", "stacked radial bar chart"],
    rgbar: ["radial grouped bar chart", "group radial bar chart"],
    cbar: ["circular bar chart"],
    csbar: ["circular stacked bar chart", "stacked circular bar chart"],
    cgbar: ["circular grouped bar chart", "grouped circular bar chart"],

    // Area charts (Area Chart)
    vparea: [
      "proportional area chart",
      "proportional area chart (circle)",
      "proportional area chart (square)",
      "proportional area chart (triangle)",
      "proportional area chart (hexagon)",
      "proportional area chart (pentagram)",
    ],
    hparea: [
      "proportional area chart",
      "proportional area chart (circle)",
      "proportional area chart (square)",
      "proportional area chart (triangle)",
      "proportional area chart (hexagon)",
      "proportional area chart (pentagram)",
    ],
    rparea: ["radial area chart"],

    // Line charts (Line Chart)
    vline: [
      "multiple line graph",
      "line graph",
      "spline graph",
      "stepped line graph",
      "multiple step line graph",
      "multiple spline graph",
    ],
    vsline: [
      "multiple line graph",
      "line graph",
      "spline graph",
      "stepped line graph",
      "multiple step line graph",
      "multiple spline graph",
    ],
    hline: [
      "multiple line graph",
      "line graph",
      "spline graph",
      "stepped line graph",
      "multiple step line graph",
      "multiple spline graph",
    ],
    hsline: [
      "multiple line graph",
      "line graph",
      "spline graph",
      "stepped line graph",
      "multiple step line graph",
      "multiple spline graph",
    ],
    rline: ["radial line chart"],
    rsline: ["radial line chart"],

    // Scatter plots (Scatter Plot)
    vscatter: ["scatterplot", "grouped scatterplot"],
    vsscatter: ["scatterplot", "grouped scatterplot"],
    hscatter: ["scatterplot", "grouped scatterplot"],
    hsscatter: ["scatterplot", "grouped scatterplot"],
    rscatter: ["scatterplot"],
    rsscatter: ["scatterplot"],
    cscatter: ["scatterplot"],
    csscatter: ["scatterplot"],

    // Pie charts (Pie Chart)
    vpie: ["pie chart", "semicircle pie chart"],
    hpie: ["pie chart", "semicircle pie chart"],
    cpie: ["donut chart", "semicircle donut chart"],
    rpie: ["donut chart", "rose chart"],

    // Link charts (Link Chart)
    vlink: ["alluvial diagram"],
    hlink: ["alluvial diagram", "slope chart"],

    // Special chart types
    map: ["map"],
    text: ["text"],
    "circle-packing": ["bubble chart", "circle packing"],
    graph: ["graph"],
  };

  // Try an exact match on the full type.
  const fullType = `${orientation}${aggregation}${basicType}`;
  if (templateMapping[fullType]) {
    return templateMapping[fullType];
  }

  // If there is no exact match, fall back to matching by the basic type.
  const allMatches = [];
  Object.keys(templateMapping).forEach((type) => {
    // If the basic type matches, consider adding it to the results.
    if (type.endsWith(basicType)) {
      allMatches.push(...templateMapping[type]);
    }
  });

  return [...new Set(allMatches)]; // Deduplicate
}

/**
 * Find the best-matching template for a given chart type.
 * @param {string} chartType - Chart type, e.g. "vbar", "hscatter", "rpie", etc.
 * @returns {string} - The best-matching template name.
 */
export function getBestTemplateForChartType(chartType) {
  const templates = getTemplatesForChartType(chartType);
  return templates.length > 0 ? templates[0] : null;
}

/**
 * Find possible chart types that may match a given template name.
 * @param {string} templateName - Template name.
 * @returns {Array} - A list of possible chart types.
 */
export function getChartTypeForTemplate(templateName) {
  // Lowercase for case-insensitive matching.
  const lowerTemplate = templateName.toLowerCase();

  // Result array.
  const possibleChartTypes = [];

  // Iterate over chart types and check whether their templates include the given name.
  const chartTypes = [
    // Bar charts (Bar Chart)
    "vbar",
    "hbar",
    "vsbar",
    "hsbar",
    "vgbar",
    "hgbar",
    "rbar",
    "rsbar",
    "rgbar",
    "cbar",
    "csbar",
    "cgbar",

    // Area charts (Area Chart)
    "vparea",
    "hparea",
    "rparea",

    // Line charts (Line Chart)
    "vline",
    "vsline",
    "hline",
    "hsline",
    "rline",
    "rsline",

    // Scatter plots (Scatter Plot)
    "vscatter",
    "vsscatter",
    "hscatter",
    "hsscatter",
    "rscatter",
    "rsscatter",
    "cscatter",
    "csscatter",

    // Pie charts (Pie Chart)
    "vpie",
    "hpie",
    "cpie",
    "rpie",

    // Link charts (Link Chart)
    "vlink",
    "hlink",

    // Special chart types
    "map",
    "text",
    "circle-packing",
    "graph",
  ];

  for (const chartType of chartTypes) {
    const templates = getTemplatesForChartType(chartType);
    const matchingTemplates = templates.filter((template) =>
      template.toLowerCase().includes(lowerTemplate),
    );

    if (matchingTemplates.length > 0) {
      possibleChartTypes.push(chartType);
    }
  }

  return possibleChartTypes;
}

/**
 * Return the full name for a chart type code.
 * @param {string} chartType - Chart type code, e.g. "vbar", "hscatter", "rpie", etc.
 * @returns {string} - The full English name for the chart type.
 */
export function getChartTypeFullName(chartType) {
  // Mapping from chart type codes to full names.
  const chartTypeNames = {
    // Bar charts
    vbar: "vertical_bar",
    hbar: "horizontal_bar",
    vsbar: "vertical_stack_bar",
    hsbar: "horizontal_stack_bar",
    vgbar: "vertical_group_bar",
    hgbar: "horizontal_group_bar",
    rbar: "radial_bar",
    rsbar: "radial_stack_bar",
    rgbar: "radial_group_bar",
    cbar: "circular_bar",
    csbar: "circular_stack_bar",
    cgbar: "circular_group_bar",

    // Area charts
    vparea: "proportional_area",
    hparea: "proportional_area",
    rparea: "radial_area",

    // Line charts
    vline: "line",
    vsline: "line",
    hline: "line",
    hsline: "line",
    rline: "radial_line",
    rsline: "radial_line",

    // Scatter plots
    vscatter: "scatter",
    vsscatter: "scatter",
    hscatter: "scatter",
    hsscatter: "scatter",
    rscatter: "scatter",
    rsscatter: "scatter",
    cscatter: "scatter",
    csscatter: "scatter",

    // Pie charts
    vpie: "pie",
    hpie: "pie",
    cpie: "pie",
    rpie: "pie",

    // Link charts
    vlink: "alluvial",
    hlink: "alluvial",

    // Special chart types
    map: "map",
    text: "text",
    "circle-packing": "circle_packing",
    graph: "graph",
    histogram: "histogram",
    bubble: "bubble",
    donut: "donut",
    rose: "rose",
    alluvial: "alluvial_diagram",
    slope: "slope",
  };

  // If there is a direct match, return the mapped full name.
  if (chartTypeNames[chartType]) {
    return chartTypeNames[chartType];
  }

  // Otherwise, parse and construct a full name.
  const [orientation, aggregation, basicType] = extractChartType(chartType);

  const orientationNames = {
    v: "vertical",
    h: "horizontal",
    r: "radial",
    c: "circular",
  };

  const aggregationNames = {
    s: "stack",
    g: "group",
    p: "proportional",
  };

  const basicTypeNames = {
    bar: "bar",
    line: "line",
    scatter: "scatter",
    pie: "pie",
    area: "area",
    link: "link",
  };

  // Build the full name.
  let name = "";

  if (orientationNames[orientation]) {
    name += orientationNames[orientation] + "_";
  }

  if (aggregationNames[aggregation]) {
    name += aggregationNames[aggregation] + "_";
  }

  if (basicTypeNames[basicType]) {
    name += basicTypeNames[basicType];
  } else {
    // If the basic type is unknown, fall back to the original value.
    name += basicType.toLowerCase();
  }

  return name.replace(/_$/, ""); // Remove a trailing underscore if any
}
