/**
 * The kit a host page draws itself, with no compiler: the components a chat answer's ```ui
 * fence may use, the stylesheet for a Shadow DOM root, and the bridge that opens links and
 * copies text for them. Kept apart from the runtime so it never pulls in sucrase or esbuild.
 */

import { Metrics, Steps } from "./kit/data.js";
import { Diagram } from "./kit/diagram.js";
import { Callout, Grid } from "./kit/layout.js";

export type { HostBridge } from "./kit/host-bridge.js";
export { HostBridgeContext } from "./kit/host-bridge.js";
export { PageLanguage } from "./kit/labels.js";
export { SHADOW_STYLES } from "./kit/shadow-styles.js";

export const visualKit = { Callout, Diagram, Grid, Metrics, Steps };
