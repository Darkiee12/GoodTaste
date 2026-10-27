import { Data } from "effect";

import { Latitude, Longitude } from "@/components/home/globe/geo-utils";
import type { Locale } from "@/shared/i18n";

/** Window event that asks the globe to spotlight a random visible dish. */
export const SURPRISE_DISH_EVENT = "feastjourney:surprise-dish";

/** Discovery-section category used to filter the curated dishes. */
export type FoodCategory = Data.TaggedEnum<{
  readonly LocalFavorites: {};
  readonly StreetFood: {};
  readonly ComfortingBowls: {};
  readonly WorthTravelling: {};
}>;

export const { LocalFavorites, StreetFood, ComfortingBowls, WorthTravelling, $match } =
  Data.taggedEnum<FoodCategory>();

/**
 * One curated dish shown on the homepage globe and in the discovery section.
 * Coordinates are representative display anchors for the listed city, not
 * claims about a dish's exact origin.
 */
export type FoodLocation = {
  id: string;
  name: string;
  country: ReadonlyMap<Locale, string>;
  region: ReadonlyMap<Locale, string>;
  latitude: Latitude;
  longitude: Longitude;
  emoji: string;
  description: ReadonlyMap<Locale, string>;
  categories: Array<FoodCategory>;
};

/** Dishes carrying the given category tag, matched exhaustively via $match. */
export function dishesInCategory(
  dishes: Array<FoodLocation>,
  tag: FoodCategory["_tag"],
): Array<FoodLocation> {
  return dishes.filter((dish) =>
    dish.categories.some((category) =>
      $match(category, {
        LocalFavorites: () => tag === "LocalFavorites",
        StreetFood: () => tag === "StreetFood",
        ComfortingBowls: () => tag === "ComfortingBowls",
        WorthTravelling: () => tag === "WorthTravelling",
      }),
    ),
  );
}

/** Localized dish text with an English fallback when a locale entry is missing. */
export function localizedDishText(text: ReadonlyMap<Locale, string>, lang: Locale): string {
  return text.get(lang) ?? text.get("en") ?? "";
}

/** Sixteen dishes spanning Asia, Europe, Africa, North and South America, and Oceania. */
export const FOOD_LOCATIONS: Array<FoodLocation> = [
  {
    id: "pho",
    name: "Phở",
    country: new Map<Locale, string>([
      ["en", "Vietnam"],
      ["vi", "Việt Nam"],
      ["hi", "वियतनाम"],
      ["es", "Vietnam"],
      ["zh", "越南"],
    ]),
    region: new Map<Locale, string>([
      ["en", "Southeast Asia"],
      ["vi", "Đông Nam Á"],
      ["hi", "दक्षिण-पूर्व एशिया"],
      ["es", "Sudeste Asiático"],
      ["zh", "东南亚"],
    ]),
    latitude: Latitude(21.0285),
    longitude: Longitude(105.8542),
    emoji: "🍜",
    description: new Map<Locale, string>([
      ["en", "Hanoi's beloved noodle soup, fragrant with star anise, cinnamon, and fresh herbs."],
      ["vi", "Món phở Hà Nội thơm nức mùi hoa hồi, quế và rau thơm tươi."],
      ["hi", "हनोई का प्रिय नूडल सूप, चक्र फूल, दालचीनी और ताज़ी जड़ी-बूटियों की खुशबू से भरपूर।"],
      [
        "es",
        "La querida sopa de fideos de Hanói, con aroma de anís estrellado, canela y hierbas frescas.",
      ],
      ["zh", "河内人热爱的一碗汤粉，八角、肉桂和新鲜香草香气扑鼻。"],
    ]),
    categories: [LocalFavorites(), StreetFood(), ComfortingBowls()],
  },
  {
    id: "sushi",
    name: "Sushi",
    country: new Map<Locale, string>([
      ["en", "Japan"],
      ["vi", "Nhật Bản"],
      ["hi", "जापान"],
      ["es", "Japón"],
      ["zh", "日本"],
    ]),
    region: new Map<Locale, string>([
      ["en", "East Asia"],
      ["vi", "Đông Á"],
      ["hi", "पूर्व एशिया"],
      ["es", "Asia Oriental"],
      ["zh", "东亚"],
    ]),
    latitude: Latitude(35.6762),
    longitude: Longitude(139.6503),
    emoji: "🍣",
    description: new Map<Locale, string>([
      ["en", "Vinegared rice and pristine fish, prepared with quiet precision."],
      ["vi", "Cơm trộn giấm ăn cùng cá tươi ngon, chế biến đầy tinh tế."],
      ["hi", "सिरके वाले चावल और बेहतरीन ताज़ी मछली, शांत सटीकता के साथ तैयार।"],
      ["es", "Arroz avinagrado y pescado impecable, preparado con silenciosa precisión."],
      ["zh", "醋饭配新鲜上等的鱼生，以沉静的匠心制作。"],
    ]),
    categories: [LocalFavorites(), WorthTravelling()],
  },
  {
    id: "pizza-napoletana",
    name: "Pizza Napoletana",
    country: new Map<Locale, string>([
      ["en", "Italy"],
      ["vi", "Ý"],
      ["hi", "इटली"],
      ["es", "Italia"],
      ["zh", "意大利"],
    ]),
    region: new Map<Locale, string>([
      ["en", "Southern Europe"],
      ["vi", "Nam Âu"],
      ["hi", "दक्षिण यूरोप"],
      ["es", "Europa del Sur"],
      ["zh", "南欧"],
    ]),
    latitude: Latitude(40.8518),
    longitude: Longitude(14.2681),
    emoji: "🍕",
    description: new Map<Locale, string>([
      ["en", "Blistered, leopard-spotted crust from a wood-fired Neapolitan oven."],
      ["vi", "Đế bánh phồng giòn với những đốm cháy đặc trưng từ lò củi Naples."],
      ["hi", "नेपल्स की लकड़ी की भट्टी में सिकी फूली हुई, तेंदुए जैसे धब्बों वाली परत।"],
      ["es", "Masa ampollada con manchas de leopardo, salida de un horno de leña napolitano."],
      ["zh", "那不勒斯柴火窑烤出的饼底，气泡鼓起，带着豹纹般的焦斑。"],
    ]),
    categories: [LocalFavorites(), WorthTravelling()],
  },
  {
    id: "tacos-al-pastor",
    name: "Tacos al pastor",
    country: new Map<Locale, string>([
      ["en", "Mexico"],
      ["vi", "México"],
      ["hi", "मेक्सिको"],
      ["es", "México"],
      ["zh", "墨西哥"],
    ]),
    region: new Map<Locale, string>([
      ["en", "North America"],
      ["vi", "Bắc Mỹ"],
      ["hi", "उत्तर अमेरिका"],
      ["es", "Norteamérica"],
      ["zh", "北美洲"],
    ]),
    latitude: Latitude(19.4326),
    longitude: Longitude(-99.1332),
    emoji: "🌮",
    description: new Map<Locale, string>([
      ["en", "Marinated pork shaved off the trompo, with pineapple, onion, and cilantro."],
      ["vi", "Thịt heo ướp nướng trên trụ xoay, ăn cùng dứa, hành tây và ngò."],
      ["hi", "ट्रोम्पो से कतरा हुआ मसालेदार सूअर का मांस, अनानास, प्याज़ और धनिये के साथ।"],
      ["es", "Cerdo adobado cortado del trompo, con piña, cebolla y cilantro."],
      ["zh", "旋转烤架上片下的腌猪肉，配菠萝、洋葱和香菜。"],
    ]),
    categories: [LocalFavorites(), StreetFood()],
  },
  {
    id: "tagine",
    name: "Tagine",
    country: new Map<Locale, string>([
      ["en", "Morocco"],
      ["vi", "Ma-rốc"],
      ["hi", "मोरक्को"],
      ["es", "Marruecos"],
      ["zh", "摩洛哥"],
    ]),
    region: new Map<Locale, string>([
      ["en", "North Africa"],
      ["vi", "Bắc Phi"],
      ["hi", "उत्तर अफ्रीका"],
      ["es", "Norte de África"],
      ["zh", "北非"],
    ]),
    latitude: Latitude(31.6295),
    longitude: Longitude(-7.9811),
    emoji: "🍲",
    description: new Map<Locale, string>([
      ["en", "Meat and vegetables slow-cooked in a conical clay pot with warm spices."],
      ["vi", "Thịt và rau củ om chậm trong nồi đất hình nón cùng gia vị ấm nồng."],
      ["hi", "शंक्वाकार मिट्टी के बर्तन में गर्म मसालों के साथ धीमी आंच पर पका मांस और सब्ज़ियां।"],
      [
        "es",
        "Carne y verduras cocidas a fuego lento en una olla cónica de barro con especias cálidas.",
      ],
      ["zh", "肉和蔬菜在锥形陶锅中用温暖香料慢炖而成。"],
    ]),
    categories: [ComfortingBowls(), WorthTravelling()],
  },
  {
    id: "jollof-rice",
    name: "Jollof rice",
    country: new Map<Locale, string>([
      ["en", "Nigeria"],
      ["vi", "Nigeria"],
      ["hi", "नाइजीरिया"],
      ["es", "Nigeria"],
      ["zh", "尼日利亚"],
    ]),
    region: new Map<Locale, string>([
      ["en", "West Africa"],
      ["vi", "Tây Phi"],
      ["hi", "पश्चिम अफ्रीका"],
      ["es", "África Occidental"],
      ["zh", "西非"],
    ]),
    latitude: Latitude(6.5244),
    longitude: Longitude(3.3792),
    emoji: "🍚",
    description: new Map<Locale, string>([
      [
        "en",
        "Smoky party rice simmered in tomato and pepper, the soul of every Lagos celebration.",
      ],
      ["vi", "Cơm party thơm khói nấu với cà chua và ớt, linh hồn của mọi bữa tiệc Lagos."],
      ["hi", "टमाटर और मिर्च में पका धुएँ जैसी खुशबू वाला पार्टी चावल, लागोस के हर जश्न की जान।"],
      [
        "es",
        "Arroz de fiesta ahumado, cocido en tomate y chile: el alma de cada celebración en Lagos.",
      ],
      ["zh", "用番茄和辣椒焖煮的烟熏派对饭，是拉各斯每场庆典的灵魂。"],
    ]),
    categories: [LocalFavorites()],
  },
  {
    id: "arepas",
    name: "Arepas",
    country: new Map<Locale, string>([
      ["en", "Colombia"],
      ["vi", "Colombia"],
      ["hi", "कोलंबिया"],
      ["es", "Colombia"],
      ["zh", "哥伦比亚"],
    ]),
    region: new Map<Locale, string>([
      ["en", "South America"],
      ["vi", "Nam Mỹ"],
      ["hi", "दक्षिण अमेरिका"],
      ["es", "Sudamérica"],
      ["zh", "南美洲"],
    ]),
    latitude: Latitude(4.711),
    longitude: Longitude(-74.0721),
    emoji: "🫓",
    description: new Map<Locale, string>([
      ["en", "Golden griddled corn cakes, crisp outside and pillowy inside."],
      ["vi", "Bánh ngô nướng vàng ươm, giòn bên ngoài, mềm xốp bên trong."],
      ["hi", "सुनहरे तवे पर सिकी मकई की टिक्कियां, बाहर से कुरकुरी और अंदर से नरम।"],
      ["es", "Arepas doradas a la plancha, crujientes por fuera y esponjosas por dentro."],
      ["zh", "铁板烙出的金黄玉米饼，外脆里软。"],
    ]),
    categories: [StreetFood()],
  },
  {
    id: "ceviche",
    name: "Ceviche",
    country: new Map<Locale, string>([
      ["en", "Peru"],
      ["vi", "Peru"],
      ["hi", "पेरू"],
      ["es", "Perú"],
      ["zh", "秘鲁"],
    ]),
    region: new Map<Locale, string>([
      ["en", "South America"],
      ["vi", "Nam Mỹ"],
      ["hi", "दक्षिण अमेरिका"],
      ["es", "Sudamérica"],
      ["zh", "南美洲"],
    ]),
    latitude: Latitude(-12.0464),
    longitude: Longitude(-77.0428),
    emoji: "🦐",
    description: new Map<Locale, string>([
      ["en", "Fresh fish cured in lime juice with red onion, corn, and ají chili."],
      ["vi", "Cá tươi ướp nước chanh cùng hành tím, ngô và ớt ají."],
      ["hi", "लाल प्याज़, मकई और अही मिर्च के साथ नींबू के रस में पकी ताज़ी मछली।"],
      ["es", "Pescado fresco curado en jugo de limón con cebolla morada, maíz y ají."],
      ["zh", "新鲜鱼肉以青柠汁腌制，配紫洋葱、玉米和阿希辣椒。"],
    ]),
    categories: [LocalFavorites(), WorthTravelling()],
  },
  {
    id: "bibimbap",
    name: "Bibimbap",
    country: new Map<Locale, string>([
      ["en", "South Korea"],
      ["vi", "Hàn Quốc"],
      ["hi", "दक्षिण कोरिया"],
      ["es", "Corea del Sur"],
      ["zh", "韩国"],
    ]),
    region: new Map<Locale, string>([
      ["en", "East Asia"],
      ["vi", "Đông Á"],
      ["hi", "पूर्व एशिया"],
      ["es", "Asia Oriental"],
      ["zh", "东亚"],
    ]),
    latitude: Latitude(37.5665),
    longitude: Longitude(126.978),
    emoji: "🍱",
    description: new Map<Locale, string>([
      ["en", "Rice crowned with seasoned vegetables, egg, and gochujang — mix it all together."],
      ["vi", "Cơm với rau củ trộn, trứng và tương ớt gochujang — trộn đều rồi thưởng thức."],
      ["hi", "मसालेदार सब्ज़ियों, अंडे और गोचुजांग से सजा चावल — सब कुछ मिलाकर खाएं।"],
      ["es", "Arroz coronado con verduras sazonadas, huevo y gochujang: mézclalo todo."],
      ["zh", "米饭上铺着调味蔬菜、煎蛋和韩式辣酱——拌匀了吃。"],
    ]),
    categories: [ComfortingBowls()],
  },
  {
    id: "meat-pie",
    name: "Meat pie",
    country: new Map<Locale, string>([
      ["en", "Australia"],
      ["vi", "Úc"],
      ["hi", "ऑस्ट्रेलिया"],
      ["es", "Australia"],
      ["zh", "澳大利亚"],
    ]),
    region: new Map<Locale, string>([
      ["en", "Oceania"],
      ["vi", "Châu Đại Dương"],
      ["hi", "ओशिनिया"],
      ["es", "Oceanía"],
      ["zh", "大洋洲"],
    ]),
    latitude: Latitude(-33.8688),
    longitude: Longitude(151.2093),
    emoji: "🥧",
    description: new Map<Locale, string>([
      ["en", "Flaky pastry packed with peppery minced beef — Australia's handheld classic."],
      ["vi", "Bánh vỏ giòn nhân thịt bò bằm đậm đà — món ăn cầm tay kinh điển của Úc."],
      ["hi", "काली मिर्च वाले कीमे से भरी खस्ता पेस्ट्री — ऑस्ट्रेलिया का हाथ में खाने वाला क्लासिक।"],
      [
        "es",
        "Hojaldre crujiente relleno de carne picada a la pimienta: el clásico australiano para comer con la mano.",
      ],
      ["zh", "酥皮包裹着黑胡椒牛肉馅——澳大利亚人手一只的经典。"],
    ]),
    categories: [WorthTravelling()],
  },
  {
    id: "butter-chicken",
    name: "Butter chicken",
    country: new Map<Locale, string>([
      ["en", "India"],
      ["vi", "Ấn Độ"],
      ["hi", "भारत"],
      ["es", "India"],
      ["zh", "印度"],
    ]),
    region: new Map<Locale, string>([
      ["en", "South Asia"],
      ["vi", "Nam Á"],
      ["hi", "दक्षिण एशिया"],
      ["es", "Asia del Sur"],
      ["zh", "南亚"],
    ]),
    latitude: Latitude(28.6139),
    longitude: Longitude(77.209),
    emoji: "🍛",
    description: new Map<Locale, string>([
      [
        "en",
        "Tender chicken folded into a silky tomato-and-butter sauce, best scooped with torn naan.",
      ],
      [
        "vi",
        "Thịt gà mềm quyện trong sốt cà chua bơ mịn màng, ngon nhất khi chấm bánh naan xé tay.",
      ],
      ["hi", "मक्खन-टमाटर की मखमली ग्रेवी में नरम चिकन, हाथ से तोड़ी नान के साथ सबसे अच्छा लगता है।"],
      [
        "es",
        "Pollo tierno en una sedosa salsa de tomate y mantequilla, ideal para mojar con naan.",
      ],
      ["zh", "嫩鸡肉裹在丝滑的番茄黄油咖喱中，配手撕馕饼最美味。"],
    ]),
    categories: [LocalFavorites(), ComfortingBowls()],
  },
  {
    id: "falafel",
    name: "Falafel",
    country: new Map<Locale, string>([
      ["en", "Egypt"],
      ["vi", "Ai Cập"],
      ["hi", "मिस्र"],
      ["es", "Egipto"],
      ["zh", "埃及"],
    ]),
    region: new Map<Locale, string>([
      ["en", "Middle East"],
      ["vi", "Trung Đông"],
      ["hi", "मध्य पूर्व"],
      ["es", "Oriente Medio"],
      ["zh", "中东"],
    ]),
    latitude: Latitude(30.0444),
    longitude: Longitude(31.2357),
    emoji: "🧆",
    description: new Map<Locale, string>([
      ["en", "Crisp herb-flecked fava patties tucked into warm flatbread with tahini."],
      ["vi", "Viên đậu chiên giòn thơm rau thơm, kẹp trong bánh mì dẹt ấm cùng sốt tahini."],
      ["hi", "ताहिनी के साथ गरम रोटी में लिपटी कुरकुरी हर्ब वाली फवा टिक्कियां।"],
      ["es", "Crujientes croquetas de habas con hierbas, servidas en pan plano tibio con tahini."],
      ["zh", "酥脆的蚕豆香草丸子夹在温热的面饼里，配芝麻酱。"],
    ]),
    categories: [LocalFavorites(), StreetFood()],
  },
  {
    id: "croissant",
    name: "Croissant",
    country: new Map<Locale, string>([
      ["en", "France"],
      ["vi", "Pháp"],
      ["hi", "फ्रांस"],
      ["es", "Francia"],
      ["zh", "法国"],
    ]),
    region: new Map<Locale, string>([
      ["en", "Western Europe"],
      ["vi", "Tây Âu"],
      ["hi", "पश्चिमी यूरोप"],
      ["es", "Europa Occidental"],
      ["zh", "西欧"],
    ]),
    latitude: Latitude(48.8566),
    longitude: Longitude(2.3522),
    emoji: "🥐",
    description: new Map<Locale, string>([
      ["en", "Twenty-seven shattering layers of butter and patience from a Parisian boulangerie."],
      ["vi", "Hai mươi bảy lớp vỏ giòn tan ngậy bơ từ một tiệm bánh Paris."],
      ["hi", "पेरिस की बेकरी से मक्खन और धैर्य की सत्ताईस खस्ता परतें।"],
      [
        "es",
        "Veintisiete capas crujientes de mantequilla y paciencia, de una boulangerie parisina.",
      ],
      ["zh", "巴黎面包房出品，二十七层黄油酥皮，层层起酥。"],
    ]),
    categories: [LocalFavorites(), WorthTravelling()],
  },
  {
    id: "cheeseburger",
    name: "Cheeseburger",
    country: new Map<Locale, string>([
      ["en", "United States"],
      ["vi", "Hoa Kỳ"],
      ["hi", "संयुक्त राज्य अमेरिका"],
      ["es", "Estados Unidos"],
      ["zh", "美国"],
    ]),
    region: new Map<Locale, string>([
      ["en", "North America"],
      ["vi", "Bắc Mỹ"],
      ["hi", "उत्तर अमेरिका"],
      ["es", "Norteamérica"],
      ["zh", "北美洲"],
    ]),
    latitude: Latitude(40.7128),
    longitude: Longitude(-74.006),
    emoji: "🍔",
    description: new Map<Locale, string>([
      ["en", "A griddled patty with molten cheese in a soft bun — New York's timeless handheld."],
      [
        "vi",
        "Miếng thịt áp chảo cùng phô mai tan chảy trong bánh mì mềm — món kinh điển của New York.",
      ],
      ["hi", "नरम बन में पिघले चीज़ के साथ तवे पर सिका पैटी — न्यूयॉर्क का सदाबहार क्लासिक।"],
      ["es", "Carne a la plancha con queso fundido en pan suave: el clásico eterno de Nueva York."],
      ["zh", "铁板肉饼配融化的芝士，夹在松软面包中——纽约永恒的经典。"],
    ]),
    categories: [LocalFavorites()],
  },
  {
    id: "paella",
    name: "Paella",
    country: new Map<Locale, string>([
      ["en", "Spain"],
      ["vi", "Tây Ban Nha"],
      ["hi", "स्पेन"],
      ["es", "España"],
      ["zh", "西班牙"],
    ]),
    region: new Map<Locale, string>([
      ["en", "Southern Europe"],
      ["vi", "Nam Âu"],
      ["hi", "दक्षिण यूरोप"],
      ["es", "Europa del Sur"],
      ["zh", "南欧"],
    ]),
    latitude: Latitude(39.4699),
    longitude: Longitude(-0.3763),
    emoji: "🥘",
    description: new Map<Locale, string>([
      [
        "en",
        "Saffron rice cooked wide and shallow, crowned with seafood over a crisp socarrat base.",
      ],
      ["vi", "Cơm nghệ tây nấu trong chảo rộng, phủ hải sản cùng lớp cơm cháy socarrat giòn rụm."],
      ["hi", "केसरिया चावल चौड़े बर्तन में पकाया, कुरकुरी सोकर्राट तह पर समुद्री भोजन के साथ।"],
      ["es", "Arroz con azafrán en paella ancha, con mariscos sobre un crujiente socarrat."],
      ["zh", "宽浅锅中焖煮的藏红花饭，铺着海鲜，锅底是焦香的锅巴。"],
    ]),
    categories: [LocalFavorites(), WorthTravelling()],
  },
  {
    id: "xiaolongbao",
    name: "Xiaolongbao",
    country: new Map<Locale, string>([
      ["en", "China"],
      ["vi", "Trung Quốc"],
      ["hi", "चीन"],
      ["es", "China"],
      ["zh", "中国"],
    ]),
    region: new Map<Locale, string>([
      ["en", "East Asia"],
      ["vi", "Đông Á"],
      ["hi", "पूर्व एशिया"],
      ["es", "Asia Oriental"],
      ["zh", "东亚"],
    ]),
    latitude: Latitude(31.2304),
    longitude: Longitude(121.4737),
    emoji: "🥟",
    description: new Map<Locale, string>([
      ["en", "Eighteen-fold soup dumplings from Shanghai — lift gently, sip the broth, then bite."],
      ["vi", "Tiểu long bao Thượng Hải với mười tám nếp gấp — gắp nhẹ, húp nước súp rồi cắn."],
      ["hi", "शंघाई के अठारह तहों वाले सूप डंपलिंग — धीरे उठाएं, शोरबा पिएं, फिर खाएं।"],
      [
        "es",
        "Dumplings de sopa shanghaineses de dieciocho pliegues: levanta con cuidado, sorbe el caldo y muerde.",
      ],
      ["zh", "上海小笼包，十八道褶子——轻提、喝汤，再一口吃下。"],
    ]),
    categories: [LocalFavorites(), ComfortingBowls()],
  },
];
