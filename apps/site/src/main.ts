import "./style.css";
import { setupChrome } from "./chrome.js";
import { mountPlayground } from "./playground.js";

setupChrome();
void mountPlayground(document.getElementById("dapp")!, document.getElementById("panel")!, document.getElementById("spec")!);
