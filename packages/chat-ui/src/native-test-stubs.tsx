import { createElement } from "react";

/**
 * Vite-resolution stubs for native-only transitive dependencies of the markdown
 * renderer (fit-image, vector icons, svg). They let node tests load the renderer's
 * shipped TypeScript source without a Metro/Babel pipeline.
 */
const StubComponent = () => createElement("rn-stub");

export const MaterialDesignIcons = StubComponent;
// react-native-svg: the shapes a visual draws.
export const Circle = StubComponent;
export const Ellipse = StubComponent;
export const G = StubComponent;
export const Line = StubComponent;
export const Path = StubComponent;
export const Rect = StubComponent;
export const SvgXml = StubComponent;
export const Text = StubComponent;
export default StubComponent;
