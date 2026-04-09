import { useEffect, useRef } from "react";
import type { LogEntry } from "../Home";

interface Props {
  logs: LogEntry[];
  status: "ok" | "none" | "err";
}

export default function LogPanel({ logs, status }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs]);

  return (
    <section className="card log-card">
      <div className="log-area-fill" ref={ref}>
        {logs.map((entry, i) => (
          <div key={i} className={`log-${entry.level}`}>
            [{entry.ts}] {entry.text}
          </div>
        ))}
      </div>
    </section>
  );
}
