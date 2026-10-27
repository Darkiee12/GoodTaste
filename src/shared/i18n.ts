import { z } from "zod";

// Shared, browser-safe UI copy. Locale comes from each route match, never a singleton.
export const locales = ["en", "vi"] as const;

export type Locale = (typeof locales)[number];

export const localeSearchSchema = z.object({
  lang: z.enum(locales).catch("en"),
});

export const localeNames: Record<Locale, string> = {
  en: "English",
  vi: "Tiếng Việt",
};

const english = {
  title: "GoodTaste — A little local knowledge",
  description: "A little local knowledge for your next food adventure. GoodTaste is coming soon.",
  homeLabel: "GoodTaste home",
  skipContent: "Skip to content",
  languageLabel: "Language",
  comingSoon: "Coming soon",
  kicker: "Good food starts with curiosity.",
  heading: "Bring a little local knowledge to the table.",
  introduction:
    "Get to know a dish before you order. A little context for unfamiliar food, and room for discovery on your next trip.",
  launchNote: "GoodTaste is taking shape. More to explore soon.",
  noteHeading: "A guide, with room for questions.",
  noteBody:
    "Every kitchen is different. Confirm ingredients and preparation with the people making your food.",
  footerTagline: "A little local knowledge.",
  footerAdvice: "Stay curious. Ask before you order.",
};

type Messages = { [Key in keyof typeof english]: string };

export const messages: Record<Locale, Messages> = {
  en: english,
  vi: {
    title: "GoodTaste — Hiểu thêm về ẩm thực địa phương",
    description: "Hiểu thêm về ẩm thực địa phương cho chuyến đi tiếp theo. GoodTaste sắp ra mắt.",
    homeLabel: "Trang chủ GoodTaste",
    skipContent: "Chuyển đến nội dung",
    languageLabel: "Ngôn ngữ",
    comingSoon: "Sắp ra mắt",
    kicker: "Món ngon bắt đầu từ sự tò mò.",
    heading: "Mang chút hiểu biết địa phương vào mỗi bữa ăn.",
    introduction:
      "Tìm hiểu món ăn trước khi gọi. Hiểu thêm về những món chưa quen và khám phá nhiều hơn trong chuyến đi tiếp theo.",
    launchNote: "GoodTaste đang được xây dựng. Hẹn bạn cùng khám phá trong thời gian tới.",
    noteHeading: "Một cuốn cẩm nang để bạn tự tin đặt câu hỏi.",
    noteBody:
      "Mỗi gian bếp đều khác nhau. Hãy xác nhận nguyên liệu và cách chế biến với người chuẩn bị món ăn.",
    footerTagline: "Hiểu thêm về ẩm thực địa phương.",
    footerAdvice: "Luôn tò mò. Hỏi rõ trước khi gọi món.",
  },
};
