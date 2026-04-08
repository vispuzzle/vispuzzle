import { globalSettings } from "../core/global.js";

/**
 * Wrap text in an SVG <text> element to achieve automatic line wrapping.
 * @param {Object} textElement - D3 selection of the <text> element.
 * @param {string} textContent - The string to wrap.
 * @param {number} width - The maximum width for a line.
 * @param {number} lineHeight - The height of each line.
 * @param {number} fontSize - The font size, used for width estimation fallback.
 * @returns {{height: number, lines: number}} - An object containing the total height and line count.
 */
function wrapText(textElement, textContent, width, lineHeight, fontSize) {
  if (!textContent) {
    return { height: 0, lines: 0 };
  }

  const words = textContent.split(/\s+/).reverse();
  let word;
  let line = [];
  let lineNumber = 0;

  // Create the initial tspan.
  let tspan = textElement.append("tspan").attr("x", 0).attr("dy", "0em"); // dy=0 for the first line

  // Estimate text width: prefer browser APIs, otherwise fall back to a heuristic.
  const estimateTextWidth = (text) => {
    // Prefer getComputedTextLength in browser environments.
    if (
      typeof window !== "undefined" &&
      tspan.node() &&
      tspan.node().getComputedTextLength
    ) {
      try {
        tspan.text(text); // Must set text before measuring
        return tspan.node().getComputedTextLength();
      } catch (e) {
        // On error, fall back to the heuristic.
      }
    }
    // Simple estimate in Node.js or other non-browser environments.
    // Assume average character width is ~0.5 * fontSize.
    return text.length * fontSize * 0.5;
  };

  while ((word = words.pop())) {
    line.push(word);
    tspan.text(line.join(" "));

    // If the current line exceeds the allowed width.
    if (estimateTextWidth(line.join(" ")) > width) {
      // If the line has more than one word, step back one word.
      if (line.length > 1) {
        line.pop();
        tspan.text(line.join(" "));
      }

      // Create a new line.
      line = [word];
      lineNumber++;
      tspan = textElement
        .append("tspan")
        .attr("x", 0)
        .attr("dy", `${lineHeight}px`) // Use absolute line height for wrapping
        .text(word);
    }
  }

  const finalLineCount = lineNumber + 1;
  const totalHeight = finalLineCount * lineHeight;

  return { height: totalHeight, lines: finalLineCount };
}

/**
 * Create a chart title and subtitle.
 * @param {Object} titleGroup - SVG element (D3 selection)
 * @param {Object} visTreeRoot - Visualization tree root containing { title, subtitle }
 * @param {number} chartWidth - Chart width
 * @returns {Object} - { height, node } where node is the title group
 */
export function createChartTitle(titleGroup, visTreeRoot, chartWidth = 800) {
  if (!visTreeRoot.title) return { height: 0, node: null };

  const titlePadding = 35; // Spacing between title text and the decorative bar
  const effectiveWidth = chartWidth - titlePadding; // Effective width for title and subtitle

  // --- Title ---
  const titleFontSize = globalSettings.getFontSize("title");
  const titleLineHeight = titleFontSize * 1.2; // Title line height

  const titleText = titleGroup
    .append("text")
    .attr("class", "chart-title")
    .attr("dominant-baseline", "hanging")
    .attr("text-anchor", "start")
    .attr("fill", globalSettings.textColorDark)
    .attr("transform", `translate(${titlePadding}, 10)`);
  globalSettings.setFont(titleText, "title");

  // Apply wrapping and get title height.
  const titleMetrics = wrapText(
    titleText,
    visTreeRoot.title,
    effectiveWidth,
    titleLineHeight,
    titleFontSize,
  );
  let totalHeight = titleMetrics.height;

  // --- Subtitle ---
  if (visTreeRoot.subtitle) {
    const subtitleFontSize = globalSettings.getFontSize("description");
    const subtitleLineHeight = subtitleFontSize * 1.2; // Subtitle line height
    const titleSubtitleSpacing = 10; // Vertical spacing between title and subtitle

    // Subtitle Y starts at title height + spacing.
    const subtitleY = titleMetrics.height + titleSubtitleSpacing;

    const subtitleText = titleGroup
      .append("text")
      .attr("class", "chart-subtitle")
      .attr("dominant-baseline", "hanging")
      .attr("text-anchor", "start")
      .attr("fill", globalSettings.textColorDark)
      .attr("transform", `translate(${titlePadding}, ${10 + subtitleY})`);
    globalSettings.setFont(subtitleText, "description");

    // Apply wrapping and get subtitle height.
    const subtitleMetrics = wrapText(
      subtitleText,
      visTreeRoot.subtitle,
      effectiveWidth,
      subtitleLineHeight,
      subtitleFontSize,
    );

    // Accumulate total height.
    totalHeight += titleSubtitleSpacing + subtitleMetrics.height;
  }

  // --- Left decorative bar ---
  // Create the decorative bar; its height adapts to the content.
  titleGroup
    .append("rect")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", 20)
    .attr("height", totalHeight + 10) // Add a bit of extra space
    .attr("fill", globalSettings.palette.baseColor);

  // Position the entire title group.
  titleGroup.attr("transform", `translate(50, 80)`);

  return {
    height: totalHeight,
    node: titleGroup,
  };
}
