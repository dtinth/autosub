import fs from "fs";

const asr = JSON.parse(
  fs.readFileSync("artifacts/speechmatics_asr.json", "utf8")
);

interface Result {
  start_time: number;
  end_time: number;
  alternatives: { content: string }[];
}

type Tree =
  | { results: Result[] }
  | { results?: undefined; left: Tree; right: Tree; gap: number };

function visualize(results: Result[], gap = 0, path = "") {
  console.log(
    `${path} | ${duration(results).toFixed(1)}s ${
      results.length
    } words + ${gap.toFixed(1)}s gap`
  );
}

function visualizeTree(tree: Tree, gap = 0, path = "") {
  if (tree.results) {
    visualize(tree.results, gap, path);
  } else {
    visualizeTree(tree.left, tree.gap, path + "0");
    visualizeTree(tree.right, gap, path + "1");
  }
}

function duration(results: Result[]) {
  const first = results[0].start_time;
  const last = results[results.length - 1].end_time;
  return last - first;
}

function split(results: Result[]): Tree {
  const thisDuration = duration(results);
  if (thisDuration < 3 * 60) {
    return { results };
  }
  let bestCandidate:
    | { score: number; left: Result[]; right: Result[]; gap: number }
    | undefined;
  for (let i = 1; i < results.length; i++) {
    const left = results.slice(0, i);
    const right = results.slice(i);
    const leftDuration = duration(left);
    const rightDuration = duration(right);
    if (leftDuration < 30 || rightDuration < 30) {
      continue;
    }
    const evenness =
      Math.min(leftDuration, rightDuration) /
      Math.max(leftDuration, rightDuration);
    const gap = thisDuration - leftDuration - rightDuration;
    const score = evenness * gap;
    if (!bestCandidate || score > bestCandidate.score) {
      bestCandidate = { score, left, right, gap };
    }
  }
  if (!bestCandidate) {
    throw new Error("No best candidate found");
  }
  return {
    left: split(bestCandidate.left),
    right: split(bestCandidate.right),
    gap: bestCandidate.gap,
  };
}

function generateParts(root: Tree) {
  const parts: { name: string; start: number; end: number }[] = [];
  const traverse = (tree: Tree, gap = 0) => {
    if (tree.results) {
      parts.push({
        name: `part_` + (parts.length + 1).toString().padStart(2, "0"),
        start: tree.results[0].start_time,
        end: tree.results[tree.results.length - 1].end_time + gap * 0.75,
      });
    } else {
      traverse(tree.left, tree.gap);
      traverse(tree.right, gap);
    }
  };
  traverse(root);
  for (let i = 0; i < parts.length - 1; i++) {
    parts[i].start = i > 0 ? parts[i - 1].end : 0;
  }
  console.log(parts);
  return parts;
}

const root: Tree = split(asr.results);
visualizeTree(root);
const parts = generateParts(root);
fs.writeFileSync("artifacts/parts.json", JSON.stringify(parts, null, 2));
