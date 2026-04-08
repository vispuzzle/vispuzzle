// This file generates the layout for the visualization tree.

import { globalSettings } from "./global.js";
import { handleBasicMode, postprocessBasicMode } from "./layout/basic.js";
import { handleMirrorMode, postprocessMirrorMode } from "./layout/mirror.js";
import {
  handleRepetitionMode,
  postprocessRepetitionMode,
} from "./layout/repetition.js";
import { handleLinkageMode, postprocessLinkageMode } from "./layout/linkage.js";
import { handleNestingMode, postprocessNestingMode } from "./layout/nesting.js";
import {
  handleCoordinateMode,
  postprocessCoordinateMode,
} from "./layout/coordinate.js";
import {
  handleAnnotationMode,
  postprocessAnnotationMode,
} from "./layout/annotation.js";
import {
  extractOperation,
  findNodefromColumn,
  getcompositionMode,
  traverseAllNodes,
  traverseLeafNodes,
  traverseUnionNodes,
} from "../utils/node.js";
import { setTopicStyle } from "../utils/topic.js";

function generateVisTree() {
  const visNodes = globalSettings.visNodes;
  for (const key in visNodes) {
    const node = visNodes[key];
    if (node.view) {
      // basic chart
      Object.assign(node, node.view);
      delete node.view;
      node.children = [];
    }
    node.id = key;
    node.parent = null;
    node.importance = node.importance || 1; // set default importance
  }

  // Loop through the keys in reverse order
  const keys = Object.keys(visNodes);
  for (let i = keys.length - 1; i >= 0; i--) {
    const key = keys[i];
    const node = visNodes[key];
    node.neighbors = {
      left: null,
      right: null,
      top: null,
      bottom: null,
      inner: [],
      outer: null,
    };
    if (node.vis_type === "composite") {
      // set parent-child relationships
      node.children = node.children || [];
      let childrenList = [];
      for (const childKey of node.children) {
        const childNode = visNodes[childKey];
        if (childNode) {
          childNode.parent = node;
        }
        childrenList.push(childNode);
      }

      // handle link node
      node.children = [];
      let hasLinkAtEnd = false;
      for (const child of childrenList) {
        const [operationType, column] = extractOperation(node.operation);
        const operateChild =
          operationType === "ALL_UNION"
            ? child
            : findNodefromColumn(child, column);
        if (!operateChild) {
          throw new Error("Failed to parse visualization tree.");
        }
        if (operateChild.chart_type && operateChild.chart_type === "link") {
          const labelAlignment = column === operateChild.X.name ? false : true;
          // labelAlignment: true means align by label field; false means align by X field
          if (!hasLinkAtEnd) {
            hasLinkAtEnd = true;
            operateChild.exchange = !labelAlignment;
            node.children.push(child);
          } else {
            operateChild.exchange = labelAlignment;
            node.children.unshift(child);
          }
          operateChild.label_alignment = labelAlignment;
        } else {
          if (hasLinkAtEnd) {
            node.children.splice(node.children.length - 1, 0, child);
          } else {
            node.children.push(child);
          }
        }
      }

      // fill in chart field (uninitialized)
      node.chart = {
        chartType: "composite",
        config: {
          top: -1,
          left: -1,
          width: -1,
          height: -1,
          innerRadius: -1,
          outerRadius: -1,
          startAngle: -1,
          endAngle: -1,
        },
      };
    }
  }

  // find root
  let root = null;
  for (const key in visNodes) {
    const node = visNodes[key];
    if (node.parent === null) {
      root = node;
      break; // assume that there's only one root
    }
  }
  return root;
}

function getAllCharts(root) {
  // inject variation configurations into chart options
  traverseAllNodes(root, (node) => {
    const variation = node.variation;
    node.chart = node.chart || {};
    node.chart.config = node.chart.config || {};
    const opts = node.chart.config.options;

    const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);

    if (variation === undefined && opts === undefined) {
      node.chart.config.options = {};
    } else if (opts === undefined) {
      node.chart.config.options = isObject(variation)
        ? { ...variation }
        : variation;
    } else if (variation === undefined) {
      node.chart.config.options = isObject(opts) ? { ...opts } : opts;
    } else {
      if (isObject(opts) && isObject(variation)) {
        // merge, variation overrides shared fields
        node.chart.config.options = { ...opts, ...variation };
      } else {
        // fall back to variation when both defined but not plain objects
        node.chart.config.options = variation;
      }
    }
  });

  const charts = [[], []];
  const polar = root.coordinate_system === "polar";

  traverseLeafNodes(root, (leafNode) => {
    leafNode.chart.id = leafNode.id;
    leafNode.chart.neighbors = leafNode.neighbors;
    charts[0].push(leafNode.chart);
  });

  traverseUnionNodes(root, (unionNode) => {
    unionNode.chart.id = unionNode.id;
    unionNode.chart.neighbors = unionNode.neighbors;
    charts[1].push(unionNode.chart);
  });

  return [[charts, polar]];
}

export async function generateConfig(visNodes) {
  globalSettings.clear();
  globalSettings.storeNodes(visNodes);
  let root = null;
  let mode = null;

  while (globalSettings.checkUpdate()) {
    globalSettings.resetNodes();
    root = generateVisTree();
    mode = getcompositionMode(root);
    setTopicStyle(root.topic, root.theme);
    if (root.order_columns) {
      globalSettings.orderColumns = root.order_columns;
    }
    if (root.axis_settings_alias) {
      globalSettings.setAxisSettingsAlias(root.axis_settings_alias);
    }

    switch (mode) {
      case "basic":
        handleBasicMode(root);
        break;
      case "mirror":
        handleMirrorMode(root);
        break;
      case "linkage":
        handleLinkageMode(root);
        break;
      case "repetition":
        await handleRepetitionMode(root);
        break;
      case "nesting":
        handleNestingMode(root);
        break;
      case "coordinate":
        handleCoordinateMode(root);
        break;
      case "annotation":
        handleAnnotationMode(root);
        break;
      default:
        throw new Error("Unsupported composition mode: " + mode);
    }

    // now we only update chart style for "basic" mode
    if (mode !== "basic") {
      globalSettings.updateFlag = false;
    }
  }
  if (true) {
    let width = root.chart.config.width;
    let height = root.chart.config.height;
    if (root.coordinate_system === "polar") {
      width =
        (root.chart.config.outerRadius - root.chart.config.innerRadius + 200) *
        2;
      height = width;
    }
    const fontRatio = Math.max(width / 1600, height / 900);
    if (fontRatio > 1) {
      Object.keys(globalSettings.fontSizeTable).forEach((key) => {
        globalSettings.fontSizeTable[key] = Math.floor(
          globalSettings.fontSizeTable[key] * fontRatio,
        );
      });
      globalSettings.labelCharWidth = globalSettings.labelCharWidth * fontRatio;
      globalSettings.valueCharWidth = globalSettings.valueCharWidth * fontRatio;
      globalSettings.minFontSize = Math.floor(
        globalSettings.minFontSize * fontRatio,
      );
      globalSettings.fontRatio = fontRatio;
    }
  }
  globalSettings.palette.assignColorMaps();

  switch (mode) {
    case "basic":
      postprocessBasicMode(root);
      break;
    case "mirror":
      postprocessMirrorMode(root);
      break;
    case "linkage":
      postprocessLinkageMode(root);
      break;
    case "repetition":
      postprocessRepetitionMode(root);
      break;
    case "nesting":
      postprocessNestingMode(root);
      break;
    case "coordinate":
      postprocessCoordinateMode(root);
      break;
    case "annotation":
      postprocessAnnotationMode(root);
      break;
  }

  console.log("Root node: ", root);
  return [getAllCharts(root), root];
}
