export async function extractAndOutputSvg(htmlString, width, height) {
  if (!htmlString) return "";

  const svgString = htmlString.querySelector("svg");
  if (!svgString) throw new Error("No SVG found in the document");
  const xmlHeader = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  const svgNamespace = `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${width} ${height}">`;
  const newSvg = svgString.outerHTML.replace(/<svg[^>]*>/, svgNamespace);
  const newSvgContent = `${xmlHeader}${newSvg}`;

  return newSvgContent;
}
