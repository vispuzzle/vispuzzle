import { globalSettings } from "../core/global.js";
import { themes } from "./themes.js";

export function setTopicStyle(topic, theme) {
  if (theme && themes[theme]) {
    globalSettings.setConfig(themes[theme]);
    return;
  }

  topic = topic || "unknown";
  const topics = getTopics();
  if (!topics[topic]) {
    // randomly pick a topic if the specified topic does not exist
    console.warn(`Topic "${topic}" not found in themes.js`);
    const keys = Object.keys(topics);
    topic = keys[Math.floor(Math.random() * keys.length)];
  }

  // Randomly pick a config.
  const configs = topics[topic];
  const randomIndex = Math.floor(Math.random() * configs.length);
  const config = configs[randomIndex];
  globalSettings.setConfig(config);
}

function _getAllBackgrounds() {
  const allBcgValues = Object.values(themes).map((theme) => theme.bcg);
  const uniqueBcgValues = [...new Set(allBcgValues)];
}

function getTopics() {
  // Aggregate configs by their topic field from themes.
  // Returns an object: key is the topic; value is an array of matching configs.
  const topics = {};
  for (const key in themes) {
    const config = themes[key];
    config.key = key;
    const topic = config.topic;
    if (!topics[topic]) {
      topics[topic] = [];
    }
    topics[topic].push(config);
  }
  return topics;
}
