import { globalSettings } from "../core/global.js";

/**
 * Creates a text element using D3.js.
 *
 * @param {string} text - The text string to display.
 * @param {Object} g - The g element to render the text in.
 * @param {number} height - The height of the SVG container.
 * @param {number} width - The width of the SVG container.
 * @param {string} color - The color of the text.
 * @param {number} fontSize - The font size of the text.
 * @param {string} fontType - The type of font to use (e.g., "label", "value").
 * @param {number} [opacity=1] - The opacity of the text (default is 1).
 * @param {string} [position="center"] - The position of the text ("center", "top-left", "top-right", "bottom-left", "bottom-right").
 * @returns {void}
 */
export function createText(
  text,
  g,
  height,
  width,
  color,
  fontSize,
  fontType,
  opacity = 1,
  position = "center",
) {
  let x, y, anchor;

  // Determine position
  switch (position) {
    case "top-left":
      x = 0;
      y = fontSize;
      anchor = "start";
      break;
    case "top-right":
      x = width;
      y = fontSize;
      anchor = "end";
      break;
    case "bottom-left":
      x = 0;
      y = height - fontSize;
      anchor = "start";
      break;
    case "bottom-right":
      x = width;
      y = height - fontSize;
      anchor = "end";
      break;
    default: // "center"
      x = width / 2;
      y = height / 2;
      anchor = "middle";
      break;
  }

  // Append the text element
  const textElement = g.append("text").attr("class", "text-label");
  textElement
    .attr("x", x)
    .attr("y", y)
    .attr("fill", color)
    .attr("font-size", fontSize)
    .style("font-weight", "bold")
    .attr("text-anchor", anchor)
    .attr("dominant-baseline", position === "center" ? "middle" : "hanging") // Adjust vertical alignment
    .text(text)
    .attr("opacity", opacity);

  globalSettings.setFont(textElement, fontType);
}
