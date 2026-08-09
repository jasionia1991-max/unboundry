import { expect, type Locator } from "@playwright/test";

export async function composeTextControl(control: Locator, values: string[]) {
  await expect(control).toBeVisible();
  await control.evaluate((element) => new Promise<void>((resolve) => {
    let previous = "";
    let stableFrames = 0;
    const sample = () => {
      const measured = element.closest(".react-flow__node") ?? element;
      const bounds = measured.getBoundingClientRect();
      const style = getComputedStyle(measured);
      const signature = [
        bounds.height,
        bounds.width,
        style.display,
        style.visibility,
      ].join(":");
      stableFrames =
        element.isConnected &&
        bounds.height > 0 &&
        bounds.width > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        signature === previous
          ? stableFrames + 1
          : 1;
      previous = signature;
      if (stableFrames >= 3) resolve();
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
  await control.focus();
  await control.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  }));
  await expect(control).toBeFocused();
  const sessionToken = await control.evaluate((element) => {
    const token = crypto.randomUUID();
    element.setAttribute("data-ime-session", token);
    return token;
  });
  await control.dispatchEvent("compositionstart", { data: "" });
  await expect(control).toHaveAttribute("data-composition-active", "true");
  for (const value of values) {
    await control.evaluate((element, nextValue) => {
      if (element instanceof HTMLInputElement) {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(element, nextValue);
      } else if (element instanceof HTMLTextAreaElement) {
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )!.set!.call(element, nextValue);
      } else {
        element.textContent = nextValue;
      }
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: nextValue,
        inputType: "insertCompositionText",
        isComposing: true,
      }));
    }, value);
  }
  await control.dispatchEvent("compositionend", {
    data: values.at(-1) ?? "",
  });
  await expect(control).not.toHaveAttribute("data-composition-active", "true");
  await expect(control).toHaveAttribute("data-ime-session", sessionToken);
  await control.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  }));
  await expect(control).toBeFocused();
  await control.evaluate((element) => {
    element.removeAttribute("data-ime-session");
  });
}
