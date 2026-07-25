import { defineConfig } from "vitest/config";

const INCLUDE = ["tests/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"];
const DOM_INCLUDE = ["tests/**/*.dom.test.{ts,tsx}", "src/**/*.dom.test.{ts,tsx}"];
const IGNORED = ["**/node_modules/**", "**/dist/**"];

// `*.dom.test.*` 만 jsdom, 나머지는 node 로 돈다.
// core/input/project 가 DOM 을 건드리면 node 환경에서 즉시 깨지는 게 설계 강제 수단이다.
// (Vitest 4 에서 environmentMatchGlobs 가 제거되어 projects 로 같은 규칙을 표현한다.)
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: INCLUDE,
          exclude: [...IGNORED, ...DOM_INCLUDE],
        },
      },
      {
        test: {
          name: "dom",
          environment: "jsdom",
          include: DOM_INCLUDE,
          exclude: IGNORED,
        },
      },
    ],
  },
});
