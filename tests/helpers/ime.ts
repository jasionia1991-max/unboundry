import type { Locator } from "@playwright/test";

export async function composeTextControl(control: Locator, values: string[]) {
  await control.focus();
  await control.dispatchEvent("compositionstart", { data: "" });
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
}
