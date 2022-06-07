// src/engine.ts
var Comparator;
(function(Comparator2) {
  Comparator2[Comparator2["LESS_THAN"] = 0] = "LESS_THAN";
  Comparator2[Comparator2["LESS_OR_EQUAL"] = 1] = "LESS_OR_EQUAL";
  Comparator2[Comparator2["GREATER_THAN"] = 2] = "GREATER_THAN";
  Comparator2[Comparator2["GREATER_OR_EQUAL"] = 3] = "GREATER_OR_EQUAL";
})(Comparator || (Comparator = {}));
var ContainerConditionType;
(function(ContainerConditionType2) {
  ContainerConditionType2[ContainerConditionType2["SizeQuery"] = 0] = "SizeQuery";
  ContainerConditionType2[ContainerConditionType2["ContainerConditionConjunction"] = 1] = "ContainerConditionConjunction";
  ContainerConditionType2[ContainerConditionType2["ContainerConditionDisjunction"] = 2] = "ContainerConditionDisjunction";
  ContainerConditionType2[ContainerConditionType2["ContainerConditionNegation"] = 3] = "ContainerConditionNegation";
})(ContainerConditionType || (ContainerConditionType = {}));
function uid() {
  return Array.from({ length: 16 }, () => Math.floor(Math.random() * 256).toString(16)).join("");
}
function translateToLogicalProp(feature) {
  switch (feature.toLowerCase()) {
    case "inlinesize":
      return "inlineSize";
    case "blocksize":
      return "blockSize";
    case "width":
      return "inlineSize";
    case "height":
      return "blockSize";
    default:
      throw Error(`Unknown feature name ${feature} in container query`);
  }
}
function isSizeQueryFulfilled(condition, borderBox) {
  const value = borderBox[translateToLogicalProp(condition.feature)];
  switch (condition.comparator) {
    case 3:
      return value >= condition.threshold;
    case 2:
      return value > condition.threshold;
    case 1:
      return value <= condition.threshold;
    case 0:
      return value < condition.threshold;
  }
}
function isQueryFullfilled_internal(condition, borderBox) {
  switch (condition.type) {
    case 1:
      return isQueryFullfilled_internal(condition.left, borderBox) && isQueryFullfilled_internal(condition.right, borderBox);
    case 2:
      return isQueryFullfilled_internal(condition.left, borderBox) || isQueryFullfilled_internal(condition.right, borderBox);
    case 3:
      return !isQueryFullfilled_internal(condition.right, borderBox);
    case 0:
      return isSizeQueryFulfilled(condition, borderBox);
    default:
      throw Error("wtf?");
  }
}
function isQueryFullfilled(condition, entry) {
  let borderBox;
  if ("borderBoxSize" in entry) {
    borderBox = entry.borderBoxSize?.[0] ?? entry.borderBoxSize;
  } else {
    const computed = getComputedStyle(entry.target);
    borderBox = {
      blockSize: entry.contentRect.height,
      inlineSize: entry.contentRect.width
    };
    borderBox.blockSize += parseInt(computed.paddingBlockStart.slice(0, -2)) + parseInt(computed.paddingBlockEnd.slice(0, -2));
    borderBox.inlineSize += parseInt(computed.paddingInlineStart.slice(0, -2)) + parseInt(computed.paddingInlineEnd.slice(0, -2));
  }
  return isQueryFullfilled_internal(condition, borderBox);
}
function findParentContainer(el, name) {
  while (el) {
    el = el.parentElement;
    if (!containerNames.has(el))
      continue;
    if (name) {
      const containerName = containerNames.get(el);
      if (!containerName.includes(name))
        continue;
    }
    return el;
  }
  return null;
}
var containerNames = new WeakMap();
function registerContainer(el, name) {
  containerRO.observe(el);
  if (!containerNames.has(el)) {
    containerNames.set(el, []);
  }
  containerNames.get(el).push(name);
}
var queries = [];
function registerContainerQuery(cqd) {
  queries.push(cqd);
}
var containerRO = new ResizeObserver((entries) => {
  const changedContainers = new Map(entries.map((entry) => [entry.target, entry]));
  for (const query of queries) {
    for (const { selector } of query.rules) {
      const els = document.querySelectorAll(selector);
      for (const el of els) {
        const container = findParentContainer(el, query.name);
        if (!container)
          continue;
        if (!changedContainers.has(container))
          continue;
        const entry = changedContainers.get(container);
        el.classList.toggle(query.className, isQueryFullfilled(query.condition, entry));
      }
    }
  }
});
var watchedContainerSelectors = [];
var containerMO = new MutationObserver((entries) => {
  for (const entry of entries) {
    for (const node of entry.removedNodes) {
      if (!(node instanceof HTMLElement))
        continue;
      containerRO.unobserve(node);
    }
    for (const node of entry.addedNodes) {
      if (!(node instanceof HTMLElement))
        continue;
      for (const watchedContainerSelector of watchedContainerSelectors) {
        if (node.matches(watchedContainerSelector.selector)) {
          registerContainer(node, watchedContainerSelector.name);
        }
        for (const container of node.querySelectorAll(watchedContainerSelector.selector)) {
          registerContainer(container, watchedContainerSelector.name);
        }
      }
    }
  }
});
containerMO.observe(document.documentElement, {
  childList: true,
  subtree: true
});
function transpileStyleSheet(sheetSrc, srcUrl) {
  const p = {
    sheetSrc,
    index: 0,
    name: srcUrl
  };
  while (p.index < p.sheetSrc.length) {
    eatWhitespace(p);
    if (p.index >= p.sheetSrc.length)
      break;
    if (lookAhead("/*", p)) {
      while (lookAhead("/*", p)) {
        eatComment(p);
        eatWhitespace(p);
      }
      continue;
    }
    if (lookAhead("@container", p)) {
      const { query, startIndex, endIndex } = parseContainerQuery(p);
      const replacement = stringifyContainerQuery(query);
      replacePart(startIndex, endIndex, replacement, p);
      registerContainerQuery(query);
    } else {
      const rule = parseQualifiedRule(p);
      if (!rule)
        continue;
      handleContainerProps(rule, p);
    }
  }
  if (!srcUrl) {
    return p.sheetSrc;
  }
  p.sheetSrc = p.sheetSrc.replace(/url\(["']*([^)"']+)["']*\)/g, (match, url) => {
    return `url(${new URL(url, srcUrl)})`;
  });
  return p.sheetSrc;
}
function handleContainerProps(rule, p) {
  const hasLongHand = rule.block.contents.includes("container-");
  const hasShortHand = rule.block.contents.includes("container:");
  if (!hasLongHand && !hasShortHand)
    return;
  let containerName, containerType;
  if (hasLongHand) {
    containerName = /container-name\s*:([^;}]+)/.exec(rule.block.contents)?.[1].trim();
    rule.block.contents = rule.block.contents.replace("container-type", "contain");
  }
  if (hasShortHand) {
    const containerShorthand = /container\s*:([^;}]+)/.exec(rule.block.contents)?.[1];
    [containerType, containerName] = containerShorthand.split("/").map((v) => v.trim());
    rule.block.contents = rule.block.contents.replace(/container: ([^;}]+)/, `contain: ${containerType};`);
  }
  if (!containerName) {
    containerName = uid();
  }
  replacePart(rule.block.startIndex, rule.block.endIndex, rule.block.contents, p);
  watchedContainerSelectors.push({
    name: containerName,
    selector: rule.selector
  });
  for (const el of document.querySelectorAll(rule.selector)) {
    registerContainer(el, containerName);
  }
}
function replacePart(start, end, replacement, p) {
  p.sheetSrc = p.sheetSrc.slice(0, start) + replacement + p.sheetSrc.slice(end);
  if (p.index >= end) {
    const delta = p.index - end;
    p.index = start + replacement.length + delta;
  }
}
function eatComment(p) {
  assertString(p, "/*");
  eatUntil("*/", p);
  assertString(p, "*/");
}
function advance(p) {
  p.index++;
  if (p.index > p.sheetSrc.length) {
    throw parseError(p, "Advanced beyond the end");
  }
}
function eatUntil(s, p) {
  const startIndex = p.index;
  while (!lookAhead(s, p)) {
    advance(p);
  }
  return p.sheetSrc.slice(startIndex, p.index);
}
function lookAhead(s, p) {
  return p.sheetSrc.substr(p.index, s.length) == s;
}
function parseSelector(p) {
  let startIndex = p.index;
  eatUntil("{", p);
  if (startIndex === p.index) {
    throw Error("Empty selector");
  }
  return p.sheetSrc.slice(startIndex, p.index);
}
function parseQualifiedRule(p) {
  const startIndex = p.index;
  const selector = parseSelector(p);
  if (!selector)
    return;
  const block = eatBlock(p);
  const endIndex = p.index;
  return {
    selector,
    block,
    startIndex,
    endIndex
  };
}
function fileName(p) {
  if (p.name) {
    return p.name;
  }
  return "<anonymous file>";
}
function parseError(p, msg) {
  return Error(`(${fileName(p)}): ${msg}`);
}
function assertString(p, s) {
  if (p.sheetSrc.substr(p.index, s.length) != s) {
    throw parseError(p, `Did not find expected sequence ${s}`);
  }
  p.index += s.length;
}
var whitespaceMatcher = /\s*/g;
function eatWhitespace(p) {
  whitespaceMatcher.lastIndex = p.index;
  const match = whitespaceMatcher.exec(p.sheetSrc);
  if (match) {
    p.index += match[0].length;
  }
}
function peek(p) {
  return p.sheetSrc[p.index];
}
var identMatcher = /[\w\\\@_-]+/g;
function parseIdentifier(p) {
  identMatcher.lastIndex = p.index;
  const match = identMatcher.exec(p.sheetSrc);
  if (!match) {
    throw parseError(p, "Expected an identifier");
  }
  p.index += match[0].length;
  return match[0];
}
function parseMeasurementName(p) {
  return parseIdentifier(p).toLowerCase();
}
var numberMatcher = /[0-9.]*/g;
function parseThreshold(p) {
  numberMatcher.lastIndex = p.index;
  const match = numberMatcher.exec(p.sheetSrc);
  if (!match) {
    throw parseError(p, "Expected a number");
  }
  p.index += match[0].length;
  assertString(p, "px");
  const value = parseFloat(match[0]);
  if (Number.isNaN(value)) {
    throw parseError(p, `${match[0]} is not a valid number`);
  }
  return value;
}
function eatBlock(p) {
  const startIndex = p.index;
  assertString(p, "{");
  let level = 1;
  while (level != 0) {
    if (p.sheetSrc[p.index] === "{") {
      level++;
    } else if (p.sheetSrc[p.index] === "}") {
      level--;
    }
    advance(p);
  }
  const endIndex = p.index;
  const contents = p.sheetSrc.slice(startIndex, endIndex);
  return { startIndex, endIndex, contents };
}
function parseLegacySizeQuery(p) {
  const measurement = parseMeasurementName(p);
  eatWhitespace(p);
  assertString(p, ":");
  eatWhitespace(p);
  const threshold = parseThreshold(p);
  eatWhitespace(p);
  assertString(p, ")");
  eatWhitespace(p);
  let comparator;
  if (measurement.startsWith("min-")) {
    comparator = 3;
  } else if (measurement.startsWith("max-")) {
    comparator = 1;
  } else {
    throw Error(`Unknown legacy container query ${measurement}`);
  }
  return {
    type: 0,
    feature: translateToLogicalProp(measurement.slice(4)),
    comparator,
    threshold
  };
}
function parseComparator(p) {
  if (lookAhead(">=", p)) {
    assertString(p, ">=");
    return 3;
  }
  if (lookAhead(">", p)) {
    assertString(p, ">");
    return 2;
  }
  if (lookAhead("<=", p)) {
    assertString(p, "<=");
    return 1;
  }
  if (lookAhead("<", p)) {
    assertString(p, "<");
    return 0;
  }
  throw Error(`Unknown comparator`);
}
function parseSizeQuery(p) {
  assertString(p, "(");
  if (lookAhead("(", p)) {
    const cond = parseContainerCondition(p);
    assertString(p, ")");
    return cond;
  }
  eatWhitespace(p);
  if (lookAhead("min-", p) || lookAhead("max-", p)) {
    return parseLegacySizeQuery(p);
  }
  const feature = parseIdentifier(p).toLowerCase();
  eatWhitespace(p);
  const comparator = parseComparator(p);
  eatWhitespace(p);
  const threshold = parseThreshold(p);
  eatWhitespace(p);
  assertString(p, ")");
  eatWhitespace(p);
  return {
    type: 0,
    feature,
    comparator,
    threshold
  };
}
function parseSizeOrStyleQuery(p) {
  eatWhitespace(p);
  if (lookAhead("(", p))
    return parseSizeQuery(p);
  else if (lookAhead("size", p)) {
    assertString(p, "size");
    eatWhitespace(p);
    return parseSizeQuery(p);
  } else if (lookAhead("style", p)) {
    throw Error(`Style query not implement yet`);
  } else {
    throw Error(`Unknown container query type`);
  }
}
function parseNegatedContainerCondition(p) {
  if (lookAhead("not", p)) {
    assertString(p, "not");
    eatWhitespace(p);
    return {
      type: 3,
      right: parseSizeOrStyleQuery(p)
    };
  }
  return parseSizeOrStyleQuery(p);
}
function parseContainerCondition(p) {
  let left = parseNegatedContainerCondition(p);
  while (true) {
    if (lookAhead("and", p)) {
      assertString(p, "and");
      eatWhitespace(p);
      const right = parseNegatedContainerCondition(p);
      eatWhitespace(p);
      left = {
        type: 1,
        left,
        right
      };
    } else if (lookAhead("or", p)) {
      assertString(p, "or");
      eatWhitespace(p);
      const right = parseNegatedContainerCondition(p);
      eatWhitespace(p);
      left = {
        type: 2,
        left,
        right
      };
    } else {
      break;
    }
  }
  return left;
}
function parseContainerQuery(p) {
  const startIndex = p.index;
  assertString(p, "@container");
  eatWhitespace(p);
  let name = "";
  if (peek(p) !== "(" && !lookAhead("size", p) && !lookAhead("style", p)) {
    name = parseIdentifier(p);
    eatWhitespace(p);
  }
  const condition = parseContainerCondition(p);
  eatWhitespace(p);
  assertString(p, "{");
  eatWhitespace(p);
  const rules = [];
  while (peek(p) !== "}") {
    rules.push(parseQualifiedRule(p));
    eatWhitespace(p);
  }
  assertString(p, "}");
  const endIndex = p.index;
  eatWhitespace(p);
  const className = `cq_${uid()}`;
  return {
    query: {
      condition,
      className,
      name,
      rules
    },
    startIndex,
    endIndex
  };
}
function stringifyContainerQuery(query) {
  return query.rules.map((rule) => `:is(${rule.selector}).${query.className} ${rule.block.contents}`).join("\n");
}

// src/cqfill.ts
function init() {
  const supportsContainerQueries = "container" in document.documentElement.style;
  if (supportsContainerQueries)
    return false;
  const sheetObserver = new MutationObserver((entries) => {
    for (const entry of entries) {
      for (const addedNode of entry.addedNodes) {
        if (addedNode instanceof HTMLStyleElement) {
          handleStyleTag(addedNode);
        }
        if (addedNode instanceof HTMLLinkElement) {
          handleLinkedStylesheet(addedNode);
        }
      }
    }
  });
  sheetObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  function handleStyleTag(el) {
    if (el.innerHTML.trim().length === 0)
      return;
    const newSrc = transpileStyleSheet(el.innerHTML);
    el.innerHTML = newSrc;
  }
  async function handleLinkedStylesheet(el) {
    if (el.rel !== "stylesheet")
      return;
    const srcUrl = new URL(el.href, document.baseURI);
    if (srcUrl.origin !== location.origin)
      return;
    const src = await fetch(srcUrl.toString()).then((r) => r.text());
    const newSrc = transpileStyleSheet(src, srcUrl.toString());
    const blob = new Blob([newSrc], { type: "text/css" });
    el.href = URL.createObjectURL(blob);
  }
  document.querySelectorAll("style").forEach((tag) => handleStyleTag(tag));
  document.querySelectorAll("link").forEach((tag) => handleLinkedStylesheet(tag));
}
export {
  init,
  transpileStyleSheet
};
