process.env.TZ = "America/Bogota";

import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

const TODAY = "2026-11-03";

jest.mock("@/src/lib/date-only", () => ({
  ...jest.requireActual("@/src/lib/date-only"),
  todayDateOnly: () => TODAY,
}));

import { DateRangeCalendar } from "@/src/features/coupons/presentation/components/DateRangeCalendar";
import { CouponEditor } from "@/src/features/coupons/presentation/components/CouponEditor";
import {
  EMPTY_COUPON_FORM,
  type CouponFormState,
} from "@/src/features/coupons/domain/coupon-form";

const day = (screen: ReturnType<typeof render>, date: string) =>
  screen.getByTestId(`calendar-day-${date}`);

const renderCalendar = (
  props: Partial<React.ComponentProps<typeof DateRangeCalendar>> = {},
) => {
  const onChange = jest.fn();
  const screen = render(
    <DateRangeCalendar
      value={{ from: null, to: null }}
      onChange={onChange}
      minDate={TODAY}
      {...props}
    />,
  );
  return { screen, onChange };
};

describe("the validity calendar", () => {
  it("opens on the current month, named in Spanish", () => {
    const { screen } = renderCalendar();
    expect(screen.getByText("noviembre 2026")).toBeTruthy();
  });

  it("walks the months in both directions, across the year boundary", () => {
    const { screen } = renderCalendar();

    fireEvent.press(screen.getByLabelText("Mes siguiente"));
    expect(screen.getByText("diciembre 2026")).toBeTruthy();

    fireEvent.press(screen.getByLabelText("Mes siguiente"));
    expect(screen.getByText("enero 2027")).toBeTruthy();

    fireEvent.press(screen.getByLabelText("Mes anterior"));
    fireEvent.press(screen.getByLabelText("Mes anterior"));
    fireEvent.press(screen.getByLabelText("Mes anterior"));
    expect(screen.getByText("octubre 2026")).toBeTruthy();
  });

  it("marks today", () => {
    const { screen } = renderCalendar();
    expect(screen.getByTestId(`calendar-today-${TODAY}`)).toBeTruthy();
  });

  it("sets the start on the first tap and the end on the second, in one view", () => {
    const onChange = jest.fn();
    const screen = render(
      <DateRangeCalendar
        value={{ from: null, to: null }}
        onChange={onChange}
        minDate={TODAY}
      />,
    );

    fireEvent.press(day(screen, "2026-11-10"));
    expect(onChange).toHaveBeenLastCalledWith({
      from: "2026-11-10",
      to: null,
    });

    screen.rerender(
      <DateRangeCalendar
        value={{ from: "2026-11-10", to: null }}
        onChange={onChange}
        minDate={TODAY}
      />,
    );
    fireEvent.press(day(screen, "2026-11-14"));
    expect(onChange).toHaveBeenLastCalledWith({
      from: "2026-11-10",
      to: "2026-11-14",
    });
  });

  it("restarts the range when the tap lands before the start", () => {
    const { screen, onChange } = renderCalendar({
      value: { from: "2026-11-20", to: null },
    });

    fireEvent.press(day(screen, "2026-11-10"));
    expect(onChange).toHaveBeenLastCalledWith({
      from: "2026-11-10",
      to: null,
    });
  });

  it("highlights the whole selected window and nothing outside it", () => {
    const { screen } = renderCalendar({
      value: { from: "2026-11-10", to: "2026-11-13" },
    });

    for (const date of [
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
    ]) {
      expect(day(screen, date).props.accessibilityState.selected).toBe(true);
    }
    expect(day(screen, "2026-11-09").props.accessibilityState.selected).toBe(
      false,
    );
    expect(day(screen, "2026-11-14").props.accessibilityState.selected).toBe(
      false,
    );
  });

  it("disables the days before the minimum and lets no tap through", () => {
    const { screen, onChange } = renderCalendar();

    expect(day(screen, "2026-11-02").props.accessibilityState.disabled).toBe(
      true,
    );
    expect(day(screen, TODAY).props.accessibilityState.disabled).toBe(false);

    fireEvent.press(day(screen, "2026-11-02"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disables nothing at all when there is no minimum", () => {
    const { screen, onChange } = renderCalendar({
      minDate: null,
      value: { from: "2026-11-01", to: null },
    });

    expect(day(screen, "2026-11-01").props.accessibilityState.disabled).toBe(
      false,
    );
    fireEvent.press(day(screen, "2026-11-02"));
    expect(onChange).toHaveBeenLastCalledWith({
      from: "2026-11-01",
      to: "2026-11-02",
    });
  });

  it("shows the chosen window through the shared date-only helper", () => {
    const { screen } = renderCalendar({
      value: { from: "2026-11-10", to: "2026-11-14" },
    });

    expect(screen.getByText("10 nov 2026 - 14 nov 2026")).toBeTruthy();
  });

  it("renders no identifier and no clock time", () => {
    const { screen } = renderCalendar({
      value: { from: "2026-11-10", to: "2026-11-14" },
    });

    const texts = screen
      .UNSAFE_getAllByType(require("react-native").Text)
      .flatMap((node: { props: { children: unknown } }) => {
        const children = node.props.children;
        return Array.isArray(children) ? children : [children];
      })
      .filter((child: unknown): child is string => typeof child === "string");

    for (const text of texts) {
      expect(text).not.toMatch(/\d{1,2}:\d{2}/);
      expect(text).not.toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      );
    }
  });
});

const editorProps = (state: CouponFormState, editing: boolean) => ({
  state,
  onChange: jest.fn(),
  products: [],
  editing,
  saving: false,
  uploading: false,
  photoReady: false,
  error: "",
  onPickPhoto: jest.fn(),
  onSave: jest.fn(),
  onCancel: jest.fn(),
});

describe("the coupon editor's validity field", () => {
  it("no longer asks the tendero to type a date", () => {
    const screen = render(
      <CouponEditor {...editorProps(EMPTY_COUPON_FORM, false)} />,
    );

    expect(screen.queryByPlaceholderText("Desde (AAAA-MM-DD)")).toBeNull();
    expect(screen.queryByPlaceholderText("Hasta (AAAA-MM-DD)")).toBeNull();
    expect(screen.getByText("noviembre 2026")).toBeTruthy();
  });

  it("disables the past while a new coupon is being created", () => {
    const screen = render(
      <CouponEditor {...editorProps(EMPTY_COUPON_FORM, false)} />,
    );

    expect(
      screen.getByTestId("calendar-day-2026-11-02").props.accessibilityState
        .disabled,
    ).toBe(true);
  });

  it("writes the chosen window into the form as date-only strings", () => {
    const props = editorProps(EMPTY_COUPON_FORM, false);
    const screen = render(<CouponEditor {...props} />);

    fireEvent.press(screen.getByTestId("calendar-day-2026-11-10"));

    expect(props.onChange).toHaveBeenCalledWith(
      expect.objectContaining({ validFrom: "2026-11-10", validTo: "" }),
    );
  });

  it("keeps a stored past start intact and still shows it while editing", () => {
    const stored: CouponFormState = {
      ...EMPTY_COUPON_FORM,
      validFrom: "2026-09-01",
      validTo: "2026-12-31",
    };
    const props = editorProps(stored, true);
    const screen = render(<CouponEditor {...props} />);

    // The calendar opens on the stored start's own month, not on today's.
    expect(screen.getByText("septiembre 2026")).toBeTruthy();
    expect(
      screen.getByTestId("calendar-day-2026-09-01").props.accessibilityState,
    ).toEqual(expect.objectContaining({ disabled: false, selected: true }));
    expect(screen.getByText("1 sep 2026 - 31 dic 2026")).toBeTruthy();
    // Nothing was rewritten just by opening the editor.
    expect(props.onChange).not.toHaveBeenCalled();
  });
});
