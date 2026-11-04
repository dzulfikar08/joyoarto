import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useState } from "react";
import { Platform } from "react-native";
import { useUnistyles } from "react-native-unistyles";

import { dayLabel, isDay, todayWib } from "@/src/lib/format";

import { Button, FieldLabel } from "./core";
import { PickerButton } from "./picker";
import { Sheet } from "./sheet";

function toDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12);
}

function toDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * A calendar day (YYYY-MM-DD, as statements print them). Android opens the system date dialog; iOS shows the inline
 * calendar in a sheet. `value` empty = no date (with `clearable`).
 */
export function DateField({
  label,
  value,
  onChange,
  min,
  max = todayWib(),
  placeholder = "Any day",
  clearable,
  compact,
}: {
  label: string;
  value: string;
  onChange: (day: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  clearable?: boolean;
  compact?: boolean;
}) {
  const { theme, rt } = useUnistyles();
  const [iosOpen, setIosOpen] = useState(false);
  const [draft, setDraft] = useState(value || max);
  const current = isDay(value) ? value : "";
  const minimumDate = min && isDay(min) ? toDate(min) : undefined;
  const maximumDate = max && isDay(max) ? toDate(max) : undefined;

  const open = () => {
    const start = current || (max && isDay(max) ? max : todayWib());
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: toDate(start),
        mode: "date",
        minimumDate,
        maximumDate,
        onChange: (event, date) => {
          if (event.type === "set" && date) onChange(toDay(date));
        },
      });
    } else {
      setDraft(start);
      setIosOpen(true);
    }
  };

  const button = <PickerButton label={label} text={current ? dayLabel(current) : placeholder} muted={!current} onPress={open} compact={compact} />;
  return (
    <>
      {compact ? button : <FieldLabel label={label}>{button}</FieldLabel>}
      {Platform.OS === "ios" ? (
        <Sheet
          open={iosOpen}
          onClose={() => setIosOpen(false)}
          title={label}
          footer={
            <>
              <Button
                title="Done"
                onPress={() => {
                  onChange(draft);
                  setIosOpen(false);
                }}
              />
              {clearable && current ? (
                <Button
                  title="Clear"
                  variant="ghost"
                  onPress={() => {
                    onChange("");
                    setIosOpen(false);
                  }}
                />
              ) : null}
            </>
          }
        >
          <DateTimePicker
            value={toDate(draft)}
            mode="date"
            display="inline"
            minimumDate={minimumDate}
            maximumDate={maximumDate}
            accentColor={theme.colors.primary}
            themeVariant={rt.themeName === "dark" ? "dark" : "light"}
            onChange={(_, date) => date && setDraft(toDay(date))}
          />
        </Sheet>
      ) : null}
    </>
  );
}
