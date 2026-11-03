// E2E only (build11-review-ci): shows the app's own blur counter (shared/glass/blurBudget writes
// "blurs live max=N (tag)" to the support log each time the most-at-once rises) as text, so uiautomator
// reads the most blurs that ran at once since launch ("BLURMAX=N tag"). The gate is N <= 2.
import { useEffect, useState } from "react";
import { Text } from "react-native";
import { supportLog } from "@/features/support/model/support-log";

function read() {
  let max = 0;
  let tag = "";
  for (const entry of supportLog.entries()) {
    const m = /blurs live max=(\d+)\s*(\(([^)]*)\))?/.exec(entry.message);
    if (m && Number(m[1]) >= max) {
      max = Number(m[1]);
      tag = m[3] ?? "";
    }
  }
  return `BLURMAX=${max} ${tag}`;
}

export function E2EBlurMax() {
  const [text, setText] = useState(read);
  useEffect(() => {
    const id = setInterval(() => setText(read()), 200);
    return () => clearInterval(id);
  }, []);
  return <Text style={{ color: "#fff", fontSize: 14, marginHorizontal: 24 }}>{text}</Text>;
}
