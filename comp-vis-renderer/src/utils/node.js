// This file contains utility functions for handling attributes of the nodes.
// For geometry attributes, please refer to `geometry.js`.
// For node adjustment, please refer to `adjust.js`.
import * as d3 from "d3";
import { globalSettings } from "../core/global.js";

export function traverseLeafNodes(node, callback) {
  if (!node.children || node.children.length === 0) {
    // leaf node
    callback(node);
  } else {
    node.children.forEach((child) => traverseLeafNodes(child, callback));
  }
}

export function traverseUnionNodes(node, callback) {
  if (
    node.children &&
    node.children.length > 0 &&
    extractOperation(node.operation)[0] === "ALL_UNION"
  ) {
    // union node
    callback(node);
  } else {
    node.children.forEach((child) => traverseUnionNodes(child, callback));
  }
}

export function traverseNonLeafNodes(node, callback, order = "post") {
  if (!node) return;
  if (order === "post") {
    if (node.children && node.children.length > 0) {
      node.children.forEach((child) => traverseNonLeafNodes(child, callback));
      callback(node);
    }
  } else if (order === "pre") {
    callback(node);
    if (node.children && node.children.length > 0) {
      node.children.forEach((child) => traverseNonLeafNodes(child, callback));
    }
  } else {
    throw new Error(`Unsupported order: ${order}`);
  }
}

export function traverseAllNodes(node, callback, order = "post") {
  if (!node) return;
  if (order === "pre") {
    callback(node);
    if (node.children) {
      node.children.forEach((child) =>
        traverseAllNodes(child, callback, order),
      );
    }
  } else if (order === "post") {
    if (node.children) {
      node.children.forEach((child) =>
        traverseAllNodes(child, callback, order),
      );
    }
    callback(node);
  } else if (order === "level") {
    const queue = [node];

    while (queue.length > 0) {
      const currentNode = queue.shift();
      callback(currentNode);

      if (currentNode.children) {
        queue.push(...currentNode.children);
      }
    }
  } else {
    throw new Error(`Unsupported order: ${order}`);
  }
}

export function isCartesian(chart) {
  // check whether `chart` is in Cartesian coordinate system or polar coordinate system.
  // once we registered a new chart type, we need to add it to the corresponding list.
  const cartesianChartList = [
    "hbar",
    "vbar",
    "hsbar",
    "vsbar",
    "vline",
    "hline",
    "hsline",
    "vsline",
    "hscatter",
    "vscatter",
    "hsscatter",
    "vsscatter",
    "hlink",
    "vlink",
    "hparea",
    "vparea",
  ];
  const polarChartList = [
    "rbar",
    "cbar",
    "rsbar",
    "csbar",
    "rline",
    "rsline",
    "cline",
    "csline",
    "rscatter",
    "cscatter",
    "rsscatter",
    "csscatter",
    "cpie",
    "rpie",
    "rparea",
  ];
  if (cartesianChartList.includes(chart.chartType)) {
    return true;
  } else if (polarChartList.includes(chart.chartType)) {
    return false;
  } else {
    throw new Error(`Unrecognized chart type: ${chart.chartType}`);
  }
}

// Judge whether the visualization coordinates should be polar or Cartesian.
// However, perhaps we can directly get the coordinate system from `node.coordinate_system`.
// So this function may become useless.
export function isPolar(root) {
  let polar = false;
  traverseAllNodes(root, (node) => {
    if (node.vis_type === "basic") {
      if (["pie"].includes(node.chart_type)) {
        // Note: this stage is before `chartTypeDerivation`, so we don't have radial/circular chart types like `rbar`, `rline`.
        // According to the result of HAIChart, perhaps only `pie` is a polar chart type.
        polar = true;
      }
    } else if (node.vis_type === "composite") {
      if (
        node.spatial_arrangement === "radial" ||
        node.spatial_arrangement === "circular"
      ) {
        polar = true;
      }
    }
  });
  return polar;
}

export function getcompositionMode(root) {
  switch (root.composite_pattern) {
    case "repetition": {
      if (
        ["regular_tessellation", "irregular_tessellation"].includes(
          root.spatial_arrangement,
        )
      ) {
        return "repetition";
      } else if (
        root.spatial_arrangement === "circular" &&
        root.spatial_distribution === "proportional"
      ) {
        return "repetition";
      } else {
        return "basic";
      }
    }
    case "linkage":
      return "linkage";
    case "nesting":
      return "nesting";
    case "coordinate":
      return "coordinate";
    case "annotation":
      return "annotation";
    case "mirror":
      return "mirror";
    default:
      return "basic";
  }
}

export function chartTypeDerivation(root) {
  const nodes = globalSettings.visNodes;
  // start orientation derivation
  let globalCircularColumn = null;
  // For "join" nodes, the alignment direction is opposite of the axis direction
  const joinAxisOrientation = {
    horizontal: "vertical",
    vertical: "horizontal",
    radial: "circular",
    circular: "radial",
    irregular: "irregular",
  };
  const orientation_to_coordinate_system = {
    horizontal: "cartesian",
    vertical: "cartesian",
    radial: "polar",
    circular: "polar",
    irregular: "irregular",
  };
  const chart_type_to_coordinate_system = {
    pie: "polar",
  };
  // Add constraints to each node
  for (const key in nodes) {
    const node = nodes[key];
    node.constraints = node.constraints || {};
    if (!node.hasOwnProperty("spatial_arrangement")) {
      continue;
    }
    // operation: COLUMN_JOIN year; UNION degree; ...
    const [operationType, operationColumnName] = extractOperation(
      node.operation,
    );
    let spatialArrangement = node.spatial_arrangement;
    if (operationType === "COLUMN_JOIN") {
      spatialArrangement = joinAxisOrientation[spatialArrangement];
    }
    let ancestor = node;
    while (ancestor) {
      if (ancestor.constraints && ancestor.constraints[operationColumnName]) {
        if (ancestor.constraints[operationColumnName] !== spatialArrangement) {
          throw new Error(
            `Conflict in the tree, the operation column ${operationColumnName} in node ${ancestor.id} has a different spatial arrangement constraint`,
          );
        }
      }

      // There might be multiple alignment directions, but here we only consider one alignment direction
      ancestor.constraints = ancestor.constraints || {};
      ancestor.constraints[operationColumnName] = spatialArrangement;

      if (spatialArrangement === "circular") {
        if (!globalCircularColumn) {
          globalCircularColumn = operationColumnName;
        } else if (globalCircularColumn !== operationColumnName) {
          throw new Error(
            "Conflict in the tree, different circular directions for the operation column",
          );
        }
      }

      if (ancestor === root) break;
      ancestor = ancestor.parent;
    }

    // For UNION nodes, the axis is generated at the current node, so it doesn't affect descendants
    // Here we only consider "join" nodes
    if (operationType === "COLUMN_JOIN") {
      const nodes = [node];
      for (const child of node.children) {
        const nodetoAdd = findNodefromColumn(child, operationColumnName);
        if (nodetoAdd) {
          nodes.push(nodetoAdd);
        }
        if (
          nodetoAdd.operation &&
          extractOperation(nodetoAdd.operation)[0] === "ALL_UNION"
        ) {
          // If the child node is a UNION node, we need to traverse its children
          nodes.push(...nodetoAdd.children);
        }
      }
      for (const node of nodes) {
        if (node.constraints && node.constraints[operationColumnName]) {
          if (node.constraints[operationColumnName] !== spatialArrangement) {
            throw new Error(
              `Conflict in the tree, the operation column ${operationColumnName} in node ${node.id} has a different alignment constraint`,
            );
          }
        }

        node.constraints = node.constraints || {};
        node.constraints[operationColumnName] = spatialArrangement;

        if (spatialArrangement === "circular") {
          if (!globalCircularColumn) {
            globalCircularColumn = operationColumnName;
          } else if (globalCircularColumn !== operationColumnName) {
            throw new Error(
              "Conflict in the tree, different circular directions for the operation column",
            );
          }
        }
      }
      // const queue = [node];

      // while (queue.length > 0) {
      //   const node = queue.shift();

      //   if (node.constraints && node.constraints[operationColumnName]) {
      //     if (node.constraints[operationColumnName] !== spatialArrangement) {
      //       throw new Error(
      //         `Conflict in the tree, the operation column ${operationColumnName} in node ${node.id} has a different alignment constraint`,
      //       );
      //     }
      //   }

      //   node.constraints = node.constraints || {};
      //   node.constraints[operationColumnName] = spatialArrangement;

      //   if (spatialArrangement === "circular") {
      //     if (!globalCircularColumn) {
      //       globalCircularColumn = operationColumnName;
      //     } else if (globalCircularColumn !== operationColumnName) {
      //       throw new Error(
      //         "Conflict in the tree, different circular directions for the operation column",
      //       );
      //     }
      //   }

      //   queue.push(...node.children);
      // }
    }

    // Set the coordinate system for each node
    const coordinateSystem =
      orientation_to_coordinate_system[spatialArrangement];
    node.coordinate_system = coordinateSystem;
    for (const child of node.children) {
      if (
        child.children.length === 0 &&
        child.chart_type in chart_type_to_coordinate_system
      ) {
        child.coordinate_system =
          chart_type_to_coordinate_system[child.chart_type];
      }
      if (
        child.coordinate_system &&
        child.coordinate_system !== coordinateSystem
      ) {
        throw new Error(
          `Conflict in the tree, the coordinate system of the child node ${child.id} is different from the parent node ${node.id}`,
        );
      }
      child.coordinate_system = coordinateSystem;
    }
  }

  const orientationMap = {
    x: {
      horizontal: "v",
      vertical: "h",
      radial: "c",
      circular: "r",
      irregular: "i",
      v: "h",
      h: "v",
      r: "c",
      c: "r",
      i: "i",
    },
    y: {
      horizontal: "h",
      vertical: "v",
      radial: "r",
      circular: "c",
      irregular: "i",
      v: "v",
      h: "h",
      r: "r",
      c: "c",
      i: "i",
    },
  };

  const stats = {};
  for (const key in nodes) {
    const node = nodes[key];
    if (node.vis_type === "composite") {
      continue;
    }

    // TODO: the next lines should not be here!!
    if (node.parent && node.parent.coordinate_system) {
      node.coordinate_system = node.parent.coordinate_system;
    } else {
      if (node.chart_type === "pie") {
        node.coordinate_system = "polar";
      } else {
        node.coordinate_system = "cartesian";
      }
    }

    const xName = node.X.name;
    const yName = node.Y.name;
    let orientationStr = "";
    for (const [key, orientation] of Object.entries(node.constraints)) {
      const axis = key === xName ? "x" : key === yName ? "y" : null;
      if (!axis) continue;

      const currentOrientation = orientationMap[axis][orientation];
      if (orientationStr && orientationStr !== currentOrientation) {
        throw new Error(
          `Conflict in the tree, the operation column ${key} in node ${node.id} has a different alignment constraint`,
        );
      }
      orientationStr = currentOrientation;
    }

    // When there is no hard constraint: If there is a parent node, try to follow the other orientation of the parent's operation column.
    if (orientationStr === "" && node.parent) {
      const parentOperationType = extractOperation(node.parent.operation)[0];
      if (parentOperationType === "COLUMN_JOIN") {
        const parentSpatialArrangement = node.parent.spatial_arrangement;
        let parentOperationColumnOrientation = parentSpatialArrangement;
        parentOperationColumnOrientation =
          joinAxisOrientation[parentOperationColumnOrientation];
        orientationStr = orientationMap["x"][parentOperationColumnOrientation]; // the other orientation
      } else {
        const firstChildChartType = node.parent.children[0].chart_type;
        if (firstChildChartType !== node.chart_type) {
          orientationStr = firstChildChartType[0];
        }
      }
    }

    // If still no orientation, set the default orientation
    if (orientationStr === "") {
      // by default
      if (node.parent?.composite_pattern === "mirror") {
        orientationStr = orientationMap["y"][node.parent.spatial_arrangement];
      } else {
        if (node.chart_type.endsWith("pie")) {
          orientationStr = "r";
        } else if (
          node.coordinate_system === "cartesian" ||
          !node.coordinate_system
        ) {
          if (node.chart_type.endsWith("bar")) {
            orientationStr = "h";
          } else if (node.chart_type.endsWith("scatter")) {
            // choose according to stats, find the largest stats for X.name and Y.name
            const x_h = stats[node.X.name]?.["h"] || 0;
            const x_v = stats[node.X.name]?.["v"] || 0;
            const y_h = stats[node.Y.name]?.["h"] || 0;
            const y_v = stats[node.Y.name]?.["v"] || 0;
            const largest = Math.max(x_h, x_v, y_h, y_v);
            if (largest === x_h || largest === y_v) {
              orientationStr = "v";
            } else if (largest === x_v || largest === y_h) {
              orientationStr = "h";
            } else {
              orientationStr = "v"; // default
            }
          } else {
            orientationStr = "v";
          }
        } else if (node.coordinate_system === "polar") {
          if (node.chart_type.endsWith("scatter")) {
            // choose according to stats, find the largest stats for X.name and Y.name
            const x_c = stats[node.X.name]?.["c"] || 0;
            const x_r = stats[node.X.name]?.["r"] || 0;
            const y_c = stats[node.Y.name]?.["c"] || 0;
            const y_r = stats[node.Y.name]?.["r"] || 0;
            const largest = Math.max(x_c, x_r, y_c, y_r);
            if (largest === x_c || largest === y_r) {
              orientationStr = "r";
            } else if (largest === x_r || largest === y_c) {
              orientationStr = "c";
            } else {
              orientationStr = "r"; // default
            }
          } else {
            orientationStr = "r";
          }
        } else {
          orientationStr = "i";
        }
      }
    }
    node.chart_type = orientationStr + node.chart_type;
    // remove possible avg(), sum() or cnt() from axis names
    const Xnamesimple = node.X.name.replace(/^(avg|sum|cnt)\((.*)\)$/, "$2");
    const Ynamesimple = node.Y.name.replace(/^(avg|sum|cnt)\((.*)\)$/, "$2");
    stats[Xnamesimple] = stats[Xnamesimple] || {};
    stats[Xnamesimple][orientationMap["x"][orientationStr]] =
      (stats[Xnamesimple][orientationMap["x"][orientationStr]] || 0) + 1;
    stats[Ynamesimple] = stats[Ynamesimple] || {};
    stats[Ynamesimple][orientationMap["y"][orientationStr]] =
      (stats[Ynamesimple][orientationMap["y"][orientationStr]] || 0) + 1;
  }
}

export function extractOperation(operation) {
  let operationType = operation.split(" ")[0];
  const operationColumn = operation.split(" ").slice(1).join(" ");
  // hack: "two_union" is a special case of "all_union"
  if (operationType === "TWO_UNION") {
    operationType = "ALL_UNION";
  }
  if (operationType === "CONDITION_JOIN") {
    operationType = "COLUMN_JOIN";
  }
  return [operationType, operationColumn];
}

export function extractChartType(chartType) {
  const basicTypes = [
    "bar",
    "line",
    "scatter",
    "pie",
    "link",
    "parea",
    "text",
    "graph",
    "map",
    "circle-packing",
    "waffle",
  ];
  let orientation = null;
  let aggregation = null;
  let basicType = null;
  for (const type of basicTypes) {
    if (chartType.endsWith(type)) {
      basicType = type;
      chartType = chartType.slice(0, -type.length);
      break;
    }
  }
  orientation = chartType[0];
  aggregation = chartType.slice(1);
  return [orientation, aggregation, basicType];
}

export function extractCondition(cond) {
  // e.g. cond: ['subject == chemistry']
  // e.g. cond: ['province != "Guangdong"']
  // TODO: handle other types of condition. E.g. cond: ['year > 1930']
  // return: {subject: 'chemistry'} or {province: 'others'}
  const condition = {};
  for (const c of cond) {
    if (c.includes("==")) {
      const [key, value] = c.split("==").map((x) => x.trim());
      condition[key] = value;
    } else if (c.includes("!=")) {
      const [key] = c.split("!=").map((x) => x.trim());
      condition[key] = "others";
    }
  }
  return condition;
}

export function findNodefromColumn(node, column) {
  function isLeaf(node) {
    return !node.children || node.children.length === 0;
  }
  function isCoaxis(node) {
    return node.composite_pattern === "coaxis";
  }
  if (isLeaf(node)) {
    if (
      node.X?.name === column ||
      node.Y?.name === column ||
      (node.chart_type.endsWith("link") && node.label_name === column)
    ) {
      return node;
    }
  }
  if (isUnion(node)) {
    const [operationType, operationColumn] = extractOperation(node.operation);
    if (
      column !== operationColumn &&
      node.constraints?.[column] &&
      node.constraints?.[operationColumn] &&
      node.constraints?.[column] === node.constraints?.[operationColumn]
    ) {
    } else {
      if (
        node.operation &&
        extractOperation(node.operation)[1] === column &&
        node.children.length > 0
      ) {
        return node;
      } else if (
        node.children[0]?.X.name === column ||
        node.children[0]?.Y.name === column
      ) {
        return node;
      }
    }
  }
  if (isCoaxis(node)) {
    if (node.operation && extractOperation(node.operation)[1] === column) {
      return node;
    }
  }
  if (!isUnion(node)) {
    for (const child of node.children) {
      const res = findNodefromColumn(child, column);
      if (res) {
        return res;
      }
    }
  }
  return null;
}

export function isUnion(node) {
  return (
    (node.operation && extractOperation(node.operation)[0] === "ALL_UNION") ||
    false
  );
}

export function getUnionValues(parent, unionName) {
  const unionValues = [];
  for (const child of parent.children) {
    const condition = extractCondition(child.conditions);
    unionValues.push(condition[unionName]);
  }
  return unionValues;
}

export function validateCompositeChart(node) {
  // check if the node is a (valid) composite chart
  // returns [true, ""] if valid, otherwise returns [false, errorMessage]

  if (!node.children?.length) {
    return [false, "no children"];
  }

  if (node.vis_type !== "composite" || node.chart?.chartType !== "composite") {
    return [false, "invalid chart type"];
  }

  const compositePatternList = [
    "repetition",
    "stack",
    "mirror",
    "linkage",
    "coaxis",
    "coordinate",
    "annotation",
    "nesting",
  ];
  const spatialArrangementList = {
    repetition: [
      "horizontal",
      "vertical",
      "circular",
      "radial",
      "irregular",
      "regular_tessellation",
      "irregular_tessellation",
    ],
    stack: ["horizontal", "vertical", "circular", "radial", "irregular"],
    mirror: ["horizontal", "vertical", "circular"],
    linkage: ["horizontal", "vertical", "irregular"],
    coaxis: ["in_place", "horizontal", "vertical", "circular", "radial"],
    coordinate: ["in_place"],
    annotation: ["nearby"],
    nesting: ["in_place"],
  };
  const spatialDistributionList = ["equal", "proportional"];

  if (
    !compositePatternList.includes(node.composite_pattern) ||
    !spatialDistributionList.includes(node.spatial_distribution) ||
    !spatialArrangementList[node.composite_pattern].includes(
      node.spatial_arrangement,
    )
  ) {
    return [false, "invalid composite chart attributes"];
  }

  return [true, ""];
}

export function validateBasicChart(node) {
  // check if the node is a (valid) basic chart
  if (
    !node.vis_type ||
    node.vis_type !== "basic" ||
    !node.children ||
    node.children.length > 0 ||
    !node.chart ||
    !node.chart.chartType ||
    node.chart.chartType === "composite"
  ) {
    return false;
  }
  return true;
}

export function getChildIndex(node) {
  // Get the index of the node in its parent's children array
  if (!node.parent || !node.parent.children) {
    return -1; // Node has no parent or parent has no children
  }
  return node.parent.children.indexOf(node);
}

export function setChildrenOption(node, field, value) {
  // Set an option for all children of the node
  if (!node.children || node.children.length === 0) {
    return;
  }
  node.children.forEach((child) => {
    child.chart.config.options[field] = value;
  });
}

export function getInputData(data, legend = false) {
  let inputData = [];
  const dataFreeChartTypes = [
    "text",
    "circle-packing",
    "map",
    "graph",
    "visual-link",
    "mirror-axis",
  ]; // Chart types that do not have X/Y data
  if (!dataFreeChartTypes.includes(data.chartType)) {
    if (data.Y.data.length === 1 || legend) {
      inputData = d3
        .zip(data.X.data[0], data.Y.data[0])
        .map(([x, y]) => ({ x, y }));
    } else {
      const processedY = data.Y.data.map((y, i) => {
        return y.map((v) => [v, data.Y.label[i]]);
      });
      if (data.X.data.length === 1) {
        inputData = d3.zip(data.X.data[0], ...processedY).map(([x, ...ys]) => {
          return ys.map(([y, label]) => ({ x, y, label }));
        });
        inputData = inputData.flat();
      } else {
        inputData = data.X.data.map((xArray, i) => {
          const yArray = processedY[i]; // Get the corresponding Y array
          return xArray.map((x, j) => {
            const [y, label] = yArray[j]; // Get the corresponding Y value and label
            return { x, y, label };
          });
        });
        inputData = inputData.flat(); // Flatten nested arrays
      }
    }
  } else {
    if (data.chartType === "map") {
      inputData = data.X.data;
    } else {
      inputData = data.data;
    }
  }
  return inputData;
}
