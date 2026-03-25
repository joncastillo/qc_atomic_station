import React from "react";
import ReactDOM from "react-dom/client";
import Home from "./home/Home.tsx";
import "./home/style.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Home />
  </React.StrictMode>,
);
