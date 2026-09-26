-- Seed vendor_config from the repo JSON. Paste into the Supabase SQL Editor AFTER 001_vendor_config.sql.
-- Safe to re-run: existing rows are left alone (use npm run config:reset to overwrite).

-- aurora
insert into public.vendor_config (vendor_id, vendor, catalog, version, updated_by)
values ('aurora', $cfg${
  "id": "aurora",
  "name": "Aurora Audio",
  "tagline": "Independent audio shop, London",
  "logo": "🌌",
  "accent": "#7c3aed",
  "port": 4101,
  "personality": "friendly independent shop owner who wins on value, not the lowest price",
  "deliveryDays": 2,
  "strategy": "Never go below 25% margin. Win on value: throw in the carry case before cutting price. Match big-box prices if we have to, but don't start a race to the bottom.",
  "minMarginPct": 25,
  "clearanceMarginPct": 15,
  "perksFirst": true,
  "codeTtlMinutes": 15,
  "scripted": {
    "openingDiscountPct": 4,
    "undercut": 3
  },
  "voice": {
    "opening": "£{price}{perks} - proper kit from a proper shop.",
    "counter": "Alright, £{price}{perks}. Better value than {rival}, and we answer the phone.",
    "hold": "We're leading - standing firm.",
    "withdraw": "Can't beat {rival} without breaking our {margin}% margin floor."
  },
  "perks": [
    {
      "id": "case",
      "label": "Free carry case",
      "costToMerchant": 8,
      "valueToBuyer": 25,
      "addonHandle": "aurora-carry-case",
      "categories": [
        "headphones"
      ]
    },
    {
      "id": "nextday",
      "label": "Free next-day delivery",
      "costToMerchant": 7,
      "valueToBuyer": 8,
      "deliveryDays": 1
    }
  ],
  "shopify": {
    "domainEnv": "AURORA_SHOPIFY_DOMAIN",
    "tokenEnv": "AURORA_SHOPIFY_TOKEN"
  }
}$cfg$::jsonb, $cfg${
  "products": [
    {
      "handle": "aurora-anc-headphones",
      "category": "headphones",
      "title": "Aurora ANC Headphones",
      "description": "Over-ear, adaptive noise cancelling, 40-hour battery, memory-foam cushions.",
      "price": 249,
      "cost": 150,
      "stock": 42,
      "emoji": "🎧",
      "comparatorQuery": "Sony WH-1000XM5 headphones price UK",
      "mockCompetitors": [
        {
          "store": "Currys",
          "price": 239,
          "url": "https://www.currys.co.uk"
        },
        {
          "store": "Amazon UK",
          "price": 229,
          "url": "https://www.amazon.co.uk"
        },
        {
          "store": "John Lewis",
          "price": 249,
          "url": "https://www.johnlewis.com"
        }
      ]
    },
    {
      "handle": "aurora-pulse-earbuds",
      "category": "earbuds",
      "title": "Pulse Wireless Earbuds",
      "description": "True wireless ANC earbuds with wireless charging case.",
      "price": 129,
      "cost": 70,
      "stock": 64,
      "emoji": "🎵",
      "comparatorQuery": "Sony WF-1000XM4 earbuds price UK",
      "mockCompetitors": [
        {
          "store": "Currys",
          "price": 119,
          "url": "https://www.currys.co.uk"
        },
        {
          "store": "Amazon UK",
          "price": 115,
          "url": "https://www.amazon.co.uk"
        }
      ]
    },
    {
      "handle": "aurora-nimbus-speaker",
      "category": "speaker",
      "title": "Nimbus Smart Speaker",
      "description": "Room-filling smart speaker with voice assistant and multi-room audio.",
      "price": 179,
      "cost": 105,
      "stock": 18,
      "emoji": "🔊",
      "comparatorQuery": "Sonos Era 100 price UK",
      "mockCompetitors": [
        {
          "store": "John Lewis",
          "price": 179,
          "url": "https://www.johnlewis.com"
        },
        {
          "store": "Richer Sounds",
          "price": 169,
          "url": "https://www.richersounds.com"
        }
      ]
    },
    {
      "handle": "aurora-carry-case",
      "category": "headphones",
      "title": "Aurora Carry Case",
      "description": "Hard-shell travel case with cable pocket.",
      "price": 40,
      "cost": 8,
      "stock": 120,
      "emoji": "💼",
      "comparatorQuery": "headphone hard carry case price UK",
      "mockCompetitors": [],
      "hidden": true
    }
  ]
}$cfg$::jsonb, 1, 'seed')
on conflict (vendor_id) do nothing;

-- soundhaus
insert into public.vendor_config (vendor_id, vendor, catalog, version, updated_by)
values ('soundhaus', $cfg${
  "id": "soundhaus",
  "name": "SoundHaus",
  "tagline": "Big-box electronics, lowest price promise",
  "logo": "⚡",
  "accent": "#d97706",
  "port": 4102,
  "personality": "sharp, numbers-driven discounter who competes on headline price",
  "deliveryDays": 4,
  "strategy": "Volume over margin: 18% minimum margin is fine. Always try to be the cheapest bid. No freebies - just price. Standard delivery is 4 days.",
  "minMarginPct": 18,
  "clearanceMarginPct": 12,
  "perksFirst": false,
  "codeTtlMinutes": 15,
  "scripted": {
    "openingDiscountPct": 4,
    "undercut": 5
  },
  "voice": {
    "opening": "£{price}. Cheapest on the board, guaranteed.",
    "counter": "Undercutting {rival}: £{price}{perks}. Done.",
    "hold": "Still the one to beat.",
    "withdraw": "Not going below {margin}% to chase {rival}. Next time."
  },
  "perks": [
    {
      "id": "express",
      "label": "Express delivery (+2 days faster)",
      "costToMerchant": 9,
      "valueToBuyer": 8,
      "deliveryDays": 2
    }
  ],
  "shopify": {
    "domainEnv": "SOUNDHAUS_SHOPIFY_DOMAIN",
    "tokenEnv": "SOUNDHAUS_SHOPIFY_TOKEN"
  }
}$cfg$::jsonb, $cfg${
  "products": [
    {
      "handle": "soundhaus-quietpro-headphones",
      "category": "headphones",
      "title": "QuietPro 700 Headphones",
      "description": "Over-ear ANC headphones, 30-hour battery, multipoint Bluetooth.",
      "price": 239,
      "cost": 150,
      "stock": 310,
      "emoji": "🎧",
      "comparatorQuery": "Bose QuietComfort headphones price UK",
      "mockCompetitors": [
        {
          "store": "Currys",
          "price": 239,
          "url": "https://www.currys.co.uk"
        },
        {
          "store": "Amazon UK",
          "price": 229,
          "url": "https://www.amazon.co.uk"
        },
        {
          "store": "John Lewis",
          "price": 249,
          "url": "https://www.johnlewis.com"
        }
      ]
    },
    {
      "handle": "soundhaus-buds-x",
      "category": "earbuds",
      "title": "Buds X ANC",
      "description": "ANC earbuds, 8h battery, IPX5.",
      "price": 119,
      "cost": 78,
      "stock": 500,
      "emoji": "🎵",
      "comparatorQuery": "Samsung Galaxy Buds price UK",
      "mockCompetitors": [
        {
          "store": "Currys",
          "price": 119,
          "url": "https://www.currys.co.uk"
        },
        {
          "store": "Amazon UK",
          "price": 115,
          "url": "https://www.amazon.co.uk"
        }
      ]
    },
    {
      "handle": "soundhaus-boom-home",
      "category": "speaker",
      "title": "Boom Home Speaker",
      "description": "Smart speaker with Alexa built in.",
      "price": 169,
      "cost": 118,
      "stock": 240,
      "emoji": "🔊",
      "comparatorQuery": "Amazon Echo Studio price UK",
      "mockCompetitors": [
        {
          "store": "John Lewis",
          "price": 179,
          "url": "https://www.johnlewis.com"
        },
        {
          "store": "Richer Sounds",
          "price": 169,
          "url": "https://www.richersounds.com"
        }
      ]
    },
    {
      "handle": "soundhaus-parka",
      "category": "jacket",
      "title": "Everyday Parka",
      "description": "Insulated parka with fleece-lined hood.",
      "price": 140,
      "cost": 82,
      "stock": 150,
      "emoji": "🧥",
      "comparatorQuery": "insulated parka jacket price UK",
      "mockCompetitors": [
        {
          "store": "JD Sports",
          "price": 150,
          "url": "https://www.jdsports.co.uk"
        },
        {
          "store": "ASOS",
          "price": 135,
          "url": "https://www.asos.com"
        }
      ]
    },
    {
      "handle": "soundhaus-zenbook-14",
      "category": "laptop",
      "title": "ZenBook 14 OLED",
      "description": "14-inch OLED ultrabook, 16GB RAM, 1TB SSD, 1.2kg.",
      "price": 899,
      "cost": 690,
      "stock": 60,
      "emoji": "💻",
      "comparatorQuery": "Asus Zenbook 14 OLED price UK",
      "mockCompetitors": [
        {
          "store": "Currys",
          "price": 879,
          "url": "https://www.currys.co.uk"
        },
        {
          "store": "Amazon UK",
          "price": 849,
          "url": "https://www.amazon.co.uk"
        },
        {
          "store": "Box",
          "price": 899,
          "url": "https://www.box.co.uk"
        }
      ]
    },
    {
      "handle": "soundhaus-barista-express",
      "category": "coffee-machine",
      "title": "Barista Express",
      "description": "Espresso machine with built-in grinder and steam wand.",
      "price": 499,
      "cost": 340,
      "stock": 45,
      "emoji": "☕",
      "comparatorQuery": "Sage Barista Express price UK",
      "mockCompetitors": [
        {
          "store": "Argos",
          "price": 499,
          "url": "https://www.argos.co.uk"
        },
        {
          "store": "John Lewis",
          "price": 529,
          "url": "https://www.johnlewis.com"
        },
        {
          "store": "Amazon UK",
          "price": 479,
          "url": "https://www.amazon.co.uk"
        }
      ]
    }
  ]
}$cfg$::jsonb, 1, 'seed')
on conflict (vendor_id) do nothing;

-- northline
insert into public.vendor_config (vendor_id, vendor, catalog, version, updated_by)
values ('northline', $cfg${
  "id": "northline",
  "name": "Northline",
  "tagline": "Premium retailer, white-glove service",
  "logo": "🏔️",
  "accent": "#059669",
  "port": 4103,
  "personality": "polished premium retailer who protects the brand and sells on service",
  "deliveryDays": 1,
  "strategy": "Protect margin - 30% minimum. Sell on service: next-day delivery is standard, offer the extra warranty year before any price cut. Walk away rather than chase the cheapest bid. Clearance outerwear can go to 20% margin.",
  "minMarginPct": 30,
  "clearanceMarginPct": 20,
  "perksFirst": true,
  "codeTtlMinutes": 15,
  "scripted": {
    "openingDiscountPct": 3,
    "undercut": 3
  },
  "voice": {
    "opening": "£{price}{perks}. Service you won't get from a warehouse.",
    "counter": "£{price}{perks} - premium, and it arrives tomorrow.",
    "hold": "Our offer stands.",
    "withdraw": "We'd rather walk than match {rival} below {margin}% margin."
  },
  "perks": [
    {
      "id": "warranty",
      "label": "+1 year warranty",
      "costToMerchant": 10,
      "valueToBuyer": 30,
      "categories": [
        "headphones",
        "earbuds",
        "speaker"
      ]
    },
    {
      "id": "returns",
      "label": "60-day free returns",
      "costToMerchant": 4,
      "valueToBuyer": 10
    }
  ],
  "shopify": {
    "domainEnv": "NORTHLINE_SHOPIFY_DOMAIN",
    "tokenEnv": "NORTHLINE_SHOPIFY_TOKEN"
  }
}$cfg$::jsonb, $cfg${
  "products": [
    {
      "handle": "northline-studio-anc",
      "category": "headphones",
      "title": "Northline Studio ANC",
      "description": "Premium ANC headphones with lossless wired mode and aluminium frame.",
      "price": 259,
      "cost": 150,
      "stock": 12,
      "emoji": "🎧",
      "comparatorQuery": "Sennheiser Momentum 4 price UK",
      "mockCompetitors": [
        {
          "store": "Currys",
          "price": 239,
          "url": "https://www.currys.co.uk"
        },
        {
          "store": "Amazon UK",
          "price": 229,
          "url": "https://www.amazon.co.uk"
        },
        {
          "store": "John Lewis",
          "price": 249,
          "url": "https://www.johnlewis.com"
        }
      ]
    },
    {
      "handle": "northline-air-buds",
      "category": "earbuds",
      "title": "Northline Air Buds",
      "description": "Hi-res earbuds with spatial audio and titanium drivers.",
      "price": 139,
      "cost": 72,
      "stock": 20,
      "emoji": "🎵",
      "comparatorQuery": "Apple AirPods Pro 2 price UK",
      "mockCompetitors": [
        {
          "store": "Currys",
          "price": 119,
          "url": "https://www.currys.co.uk"
        },
        {
          "store": "Amazon UK",
          "price": 115,
          "url": "https://www.amazon.co.uk"
        }
      ]
    },
    {
      "handle": "northline-heritage-speaker",
      "category": "speaker",
      "title": "Northline Heritage Speaker",
      "description": "Walnut-cased smart speaker with room calibration.",
      "price": 199,
      "cost": 110,
      "stock": 10,
      "emoji": "🔊",
      "comparatorQuery": "Bang & Olufsen Beosound price UK",
      "mockCompetitors": [
        {
          "store": "John Lewis",
          "price": 179,
          "url": "https://www.johnlewis.com"
        },
        {
          "store": "Richer Sounds",
          "price": 169,
          "url": "https://www.richersounds.com"
        }
      ]
    },
    {
      "handle": "northline-puffer",
      "category": "jacket",
      "title": "Northline Recycled Puffer",
      "description": "Recycled-down puffer, water-repellent. Last season's colourway.",
      "price": 160,
      "cost": 60,
      "stock": 85,
      "emoji": "🧥",
      "comparatorQuery": "North Face Nuptse jacket price UK",
      "mockCompetitors": [
        {
          "store": "JD Sports",
          "price": 150,
          "url": "https://www.jdsports.co.uk"
        },
        {
          "store": "ASOS",
          "price": 135,
          "url": "https://www.asos.com"
        }
      ],
      "clearance": true
    },
    {
      "handle": "northline-alpine-down",
      "category": "jacket",
      "title": "Northline Alpine Down",
      "description": "800-fill down jacket with storm hood. This season.",
      "price": 289,
      "cost": 150,
      "stock": 25,
      "emoji": "🧥",
      "comparatorQuery": "Canada Goose down jacket price UK",
      "mockCompetitors": [
        {
          "store": "JD Sports",
          "price": 270,
          "url": "https://www.jdsports.co.uk"
        },
        {
          "store": "ASOS",
          "price": 243,
          "url": "https://www.asos.com"
        }
      ]
    }
  ]
}$cfg$::jsonb, 1, 'seed')
on conflict (vendor_id) do nothing;

-- stride
insert into public.vendor_config (vendor_id, vendor, catalog, version, updated_by)
values ('stride', $cfg${
  "id": "stride",
  "name": "Stride Lab",
  "tagline": "Running specialist, gait-analysed fits",
  "logo": "👟",
  "accent": "#dc2626",
  "port": 4104,
  "personality": "energetic running-shop coach who sells the right fit, not just a shoe",
  "deliveryDays": 2,
  "strategy": "Keep 28% margin. Lead with a free gait fitting, then the second-pair offer, before cutting price. Clearance stock can go to 18%.",
  "minMarginPct": 28,
  "clearanceMarginPct": 18,
  "perksFirst": true,
  "codeTtlMinutes": 20,
  "scripted": {
    "openingDiscountPct": 3,
    "undercut": 3
  },
  "voice": {
    "opening": "£{price}{perks} - fitted by people who actually run.",
    "counter": "£{price}{perks}. {rival} sells boxes; we sell the right fit.",
    "hold": "Our fit beats their discount. Holding.",
    "withdraw": "Can't follow {rival} below {margin}% - enjoy the blisters."
  },
  "perks": [
    {
      "id": "gait",
      "label": "Free gait fitting",
      "costToMerchant": 5,
      "valueToBuyer": 20,
      "categories": [
        "trainers"
      ]
    },
    {
      "id": "second-pair",
      "label": "Second pair 50% off voucher",
      "costToMerchant": 12,
      "valueToBuyer": 25,
      "categories": [
        "trainers"
      ]
    }
  ],
  "shopify": {
    "domainEnv": "STRIDE_SHOPIFY_DOMAIN",
    "tokenEnv": "STRIDE_SHOPIFY_TOKEN"
  }
}$cfg$::jsonb, $cfg${
  "products": [
    {
      "handle": "stride-tempo-runner",
      "category": "trainers",
      "title": "Tempo Road Runner",
      "description": "Responsive daily road shoe with a carbon-infused plate.",
      "price": 140,
      "cost": 70,
      "stock": 80,
      "emoji": "👟",
      "comparatorQuery": "Nike Pegasus 41 price UK",
      "mockCompetitors": [
        {
          "store": "Sports Direct",
          "price": 120,
          "url": "https://www.sportsdirect.com"
        },
        {
          "store": "Runners Need",
          "price": 135,
          "url": "https://www.runnersneed.com"
        },
        {
          "store": "Amazon UK",
          "price": 125,
          "url": "https://www.amazon.co.uk"
        }
      ]
    },
    {
      "handle": "stride-trail-pro",
      "category": "trainers",
      "title": "Trail Pro GTX",
      "description": "Waterproof trail shoe with aggressive lugs.",
      "price": 165,
      "cost": 85,
      "stock": 40,
      "emoji": "👟",
      "comparatorQuery": "Salomon Speedcross GTX price UK",
      "mockCompetitors": [
        {
          "store": "Sports Direct",
          "price": 150,
          "url": "https://www.sportsdirect.com"
        },
        {
          "store": "Runners Need",
          "price": 169,
          "url": "https://www.runnersneed.com"
        },
        {
          "store": "Amazon UK",
          "price": 156,
          "url": "https://www.amazon.co.uk"
        }
      ]
    },
    {
      "handle": "stride-daily-trainer",
      "category": "trainers",
      "title": "Daily Trainer",
      "description": "Cushioned everyday trainer for easy miles.",
      "price": 95,
      "cost": 45,
      "stock": 120,
      "emoji": "👟",
      "comparatorQuery": "Asics Gel Contend price UK",
      "mockCompetitors": [
        {
          "store": "Sports Direct",
          "price": 96,
          "url": "https://www.sportsdirect.com"
        },
        {
          "store": "Runners Need",
          "price": 108,
          "url": "https://www.runnersneed.com"
        },
        {
          "store": "Amazon UK",
          "price": 100,
          "url": "https://www.amazon.co.uk"
        }
      ]
    },
    {
      "handle": "stride-rain-shell",
      "category": "jacket",
      "title": "Stride Rain Shell",
      "description": "Packable waterproof running shell with reflective trim.",
      "price": 120,
      "cost": 55,
      "stock": 60,
      "emoji": "🧥",
      "comparatorQuery": "running rain jacket price UK",
      "mockCompetitors": [
        {
          "store": "JD Sports",
          "price": 128,
          "url": "https://www.jdsports.co.uk"
        },
        {
          "store": "ASOS",
          "price": 115,
          "url": "https://www.asos.com"
        }
      ]
    }
  ]
}$cfg$::jsonb, 1, 'seed')
on conflict (vendor_id) do nothing;

-- crema
insert into public.vendor_config (vendor_id, vendor, catalog, version, updated_by)
values ('crema', $cfg${
  "id": "crema",
  "name": "Crema & Co",
  "tagline": "Coffee specialist, Bristol roastery",
  "logo": "☕",
  "accent": "#92400e",
  "port": 4105,
  "personality": "warm, slightly obsessive coffee roaster who wants you to love your first cup",
  "deliveryDays": 2,
  "strategy": "22% minimum margin. Throw in a 1 kg bag of our house beans and a barista setup call before we discount. Clearance at 14%.",
  "minMarginPct": 22,
  "clearanceMarginPct": 14,
  "perksFirst": true,
  "codeTtlMinutes": 15,
  "scripted": {
    "openingDiscountPct": 3,
    "undercut": 3
  },
  "voice": {
    "opening": "£{price}{perks} - and we'll get your first shot right.",
    "counter": "£{price}{perks}. {rival} won't teach you to pull a shot.",
    "hold": "Our beans speak for themselves. Holding.",
    "withdraw": "Below {margin}% to beat {rival}? We'll stick to roasting."
  },
  "perks": [
    {
      "id": "beans",
      "label": "Free 1 kg house beans",
      "costToMerchant": 9,
      "valueToBuyer": 28,
      "addonHandle": "crema-beans-1kg",
      "categories": [
        "coffee-machine"
      ]
    },
    {
      "id": "barista",
      "label": "Barista setup video call",
      "costToMerchant": 10,
      "valueToBuyer": 25,
      "categories": [
        "coffee-machine"
      ]
    }
  ],
  "shopify": {
    "domainEnv": "CREMA_SHOPIFY_DOMAIN",
    "tokenEnv": "CREMA_SHOPIFY_TOKEN"
  }
}$cfg$::jsonb, $cfg${
  "products": [
    {
      "handle": "crema-bean-to-cup",
      "category": "coffee-machine",
      "title": "Crema Bean-to-Cup One",
      "description": "Bean-to-cup machine with milk system and 13 grind settings.",
      "price": 549,
      "cost": 370,
      "stock": 15,
      "emoji": "☕",
      "comparatorQuery": "De'Longhi Magnifica bean to cup price UK",
      "mockCompetitors": [
        {
          "store": "Argos",
          "price": 499,
          "url": "https://www.argos.co.uk"
        },
        {
          "store": "John Lewis",
          "price": 529,
          "url": "https://www.johnlewis.com"
        },
        {
          "store": "Amazon UK",
          "price": 479,
          "url": "https://www.amazon.co.uk"
        }
      ]
    },
    {
      "handle": "crema-espresso-pro",
      "category": "coffee-machine",
      "title": "Espresso Pro Dual Boiler",
      "description": "Dual-boiler espresso machine with PID control.",
      "price": 699,
      "cost": 480,
      "stock": 8,
      "emoji": "☕",
      "comparatorQuery": "Sage Dual Boiler price UK",
      "mockCompetitors": [
        {
          "store": "Argos",
          "price": 699,
          "url": "https://www.argos.co.uk"
        },
        {
          "store": "John Lewis",
          "price": 741,
          "url": "https://www.johnlewis.com"
        },
        {
          "store": "Amazon UK",
          "price": 671,
          "url": "https://www.amazon.co.uk"
        }
      ]
    },
    {
      "handle": "crema-pod-mini",
      "category": "coffee-machine",
      "title": "Pod Mini",
      "description": "Compact pod machine, compostable pods.",
      "price": 129,
      "cost": 75,
      "stock": 50,
      "emoji": "☕",
      "comparatorQuery": "Nespresso Vertuo price UK",
      "mockCompetitors": [
        {
          "store": "Argos",
          "price": 130,
          "url": "https://www.argos.co.uk"
        },
        {
          "store": "John Lewis",
          "price": 138,
          "url": "https://www.johnlewis.com"
        },
        {
          "store": "Amazon UK",
          "price": 125,
          "url": "https://www.amazon.co.uk"
        }
      ]
    },
    {
      "handle": "crema-beans-1kg",
      "category": "coffee-machine",
      "title": "1 kg House Espresso Beans",
      "description": "Chocolatey house espresso roast.",
      "price": 28,
      "cost": 9,
      "stock": 200,
      "emoji": "🫘",
      "comparatorQuery": "specialty espresso beans 1kg price UK",
      "mockCompetitors": [],
      "hidden": true
    }
  ]
}$cfg$::jsonb, 1, 'seed')
on conflict (vendor_id) do nothing;

-- bytebazaar
insert into public.vendor_config (vendor_id, vendor, catalog, version, updated_by)
values ('bytebazaar', $cfg${
  "id": "bytebazaar",
  "name": "Byte Bazaar",
  "tagline": "Laptop reseller, graded refurbs and new",
  "logo": "💾",
  "accent": "#2563eb",
  "port": 4106,
  "personality": "fast-talking tech reseller who lives on thin margins and loves a spec sheet",
  "deliveryDays": 3,
  "strategy": "Thin margins are our game - 12% minimum. Add the extended warranty and a free sleeve before cutting price on laptops. Clearance at 8%.",
  "minMarginPct": 12,
  "clearanceMarginPct": 8,
  "perksFirst": true,
  "codeTtlMinutes": 10,
  "scripted": {
    "openingDiscountPct": 3,
    "undercut": 4
  },
  "voice": {
    "opening": "£{price}{perks}. Same silicon, smarter price.",
    "counter": "£{price}{perks} - more spec per pound than {rival}.",
    "hold": "Best spec-per-pound on the board. Holding.",
    "withdraw": "Under {margin}% to beat {rival}? The maths says no."
  },
  "perks": [
    {
      "id": "ext-warranty",
      "label": "2-year extended warranty",
      "costToMerchant": 25,
      "valueToBuyer": 60,
      "categories": [
        "laptop"
      ]
    },
    {
      "id": "sleeve",
      "label": "Free laptop sleeve",
      "costToMerchant": 6,
      "valueToBuyer": 20,
      "addonHandle": "byte-laptop-sleeve",
      "categories": [
        "laptop"
      ]
    }
  ],
  "shopify": {
    "domainEnv": "BYTEBAZAAR_SHOPIFY_DOMAIN",
    "tokenEnv": "BYTEBAZAAR_SHOPIFY_TOKEN"
  }
}$cfg$::jsonb, $cfg${
  "products": [
    {
      "handle": "byte-ultrabook-14",
      "category": "laptop",
      "title": "Ultrabook 14 (Grade A refurb)",
      "description": "14-inch ultrabook, Grade A refurbished, 16GB RAM, 512GB SSD.",
      "price": 849,
      "cost": 680,
      "stock": 30,
      "emoji": "💻",
      "comparatorQuery": "Dell XPS 14 price UK",
      "mockCompetitors": [
        {
          "store": "Currys",
          "price": 879,
          "url": "https://www.currys.co.uk"
        },
        {
          "store": "Amazon UK",
          "price": 849,
          "url": "https://www.amazon.co.uk"
        },
        {
          "store": "Box",
          "price": 899,
          "url": "https://www.box.co.uk"
        }
      ]
    },
    {
      "handle": "byte-creator-16",
      "category": "laptop",
      "title": "Creator 16 RTX",
      "description": "16-inch creator laptop with RTX graphics and 32GB RAM.",
      "price": 1299,
      "cost": 1050,
      "stock": 10,
      "emoji": "💻",
      "comparatorQuery": "Asus ProArt 16 price UK",
      "mockCompetitors": [
        {
          "store": "Currys",
          "price": 1319,
          "url": "https://www.currys.co.uk"
        },
        {
          "store": "Amazon UK",
          "price": 1274,
          "url": "https://www.amazon.co.uk"
        },
        {
          "store": "Box",
          "price": 1349,
          "url": "https://www.box.co.uk"
        }
      ]
    },
    {
      "handle": "byte-chromebook-plus",
      "category": "laptop",
      "title": "Chromebook Plus 14",
      "description": "Fast Chromebook with 8GB RAM and all-day battery.",
      "price": 399,
      "cost": 310,
      "stock": 70,
      "emoji": "💻",
      "comparatorQuery": "Chromebook Plus 14 price UK",
      "mockCompetitors": [
        {
          "store": "Currys",
          "price": 404,
          "url": "https://www.currys.co.uk"
        },
        {
          "store": "Amazon UK",
          "price": 391,
          "url": "https://www.amazon.co.uk"
        },
        {
          "store": "Box",
          "price": 414,
          "url": "https://www.box.co.uk"
        }
      ]
    },
    {
      "handle": "byte-buds-lite",
      "category": "earbuds",
      "title": "ByteBuds Lite",
      "description": "Budget ANC earbuds with 30h total battery.",
      "price": 99,
      "cost": 60,
      "stock": 150,
      "emoji": "🎵",
      "comparatorQuery": "budget ANC earbuds price UK",
      "mockCompetitors": [
        {
          "store": "Currys",
          "price": 101,
          "url": "https://www.currys.co.uk"
        },
        {
          "store": "Amazon UK",
          "price": 98,
          "url": "https://www.amazon.co.uk"
        }
      ]
    },
    {
      "handle": "byte-laptop-sleeve",
      "category": "laptop",
      "title": "Byte Laptop Sleeve",
      "description": "Padded neoprene sleeve, fits 13-16 inch.",
      "price": 30,
      "cost": 6,
      "stock": 200,
      "emoji": "🧳",
      "comparatorQuery": "laptop sleeve price UK",
      "mockCompetitors": [],
      "hidden": true
    }
  ]
}$cfg$::jsonb, 1, 'seed')
on conflict (vendor_id) do nothing;

-- peak
insert into public.vendor_config (vendor_id, vendor, catalog, version, updated_by)
values ('peak', $cfg${
  "id": "peak",
  "name": "Peak Outfitters",
  "tagline": "Outdoor gear, built to be repaired",
  "logo": "⛰️",
  "accent": "#0d9488",
  "port": 4107,
  "personality": "outdoorsy gear nerd who cares about kit lasting a lifetime",
  "deliveryDays": 3,
  "strategy": "20% minimum margin. Clearance stock can go down to 10% margin - clear it. Offer free lifetime repairs before dropping price.",
  "minMarginPct": 20,
  "clearanceMarginPct": 10,
  "perksFirst": true,
  "codeTtlMinutes": 15,
  "scripted": {
    "openingDiscountPct": 5,
    "undercut": 3
  },
  "voice": {
    "opening": "£{price}{perks} - kit that outlasts the trend.",
    "counter": "£{price}{perks}. {rival}'s won't survive a Scottish winter.",
    "hold": "Built to last, priced to hold.",
    "withdraw": "Going below {margin}% to beat {rival} isn't sustainable. Out."
  },
  "perks": [
    {
      "id": "repairs",
      "label": "Free lifetime repairs",
      "costToMerchant": 6,
      "valueToBuyer": 20
    }
  ],
  "shopify": {
    "domainEnv": "PEAK_SHOPIFY_DOMAIN",
    "tokenEnv": "PEAK_SHOPIFY_TOKEN"
  }
}$cfg$::jsonb, $cfg${
  "products": [
    {
      "handle": "peak-summit-shell",
      "category": "jacket",
      "title": "Summit 3L Shell",
      "description": "Three-layer waterproof shell with helmet-compatible hood.",
      "price": 220,
      "cost": 120,
      "stock": 30,
      "emoji": "🧥",
      "comparatorQuery": "Arc'teryx Beta jacket price UK",
      "mockCompetitors": [
        {
          "store": "JD Sports",
          "price": 225,
          "url": "https://www.jdsports.co.uk"
        },
        {
          "store": "ASOS",
          "price": 203,
          "url": "https://www.asos.com"
        }
      ]
    },
    {
      "handle": "peak-insulated-parka",
      "category": "jacket",
      "title": "Glen Insulated Parka (clearance)",
      "description": "Synthetic-insulated parka, last season's colours.",
      "price": 180,
      "cost": 95,
      "stock": 60,
      "emoji": "🧥",
      "comparatorQuery": "insulated parka jacket price UK",
      "mockCompetitors": [
        {
          "store": "JD Sports",
          "price": 150,
          "url": "https://www.jdsports.co.uk"
        },
        {
          "store": "ASOS",
          "price": 135,
          "url": "https://www.asos.com"
        }
      ],
      "clearance": true
    },
    {
      "handle": "peak-trail-runner",
      "category": "trainers",
      "title": "Ridge Trail Runner",
      "description": "Cushioned trail runner with Vibram outsole.",
      "price": 130,
      "cost": 72,
      "stock": 45,
      "emoji": "👟",
      "comparatorQuery": "Hoka Speedgoat price UK",
      "mockCompetitors": [
        {
          "store": "Sports Direct",
          "price": 120,
          "url": "https://www.sportsdirect.com"
        },
        {
          "store": "Runners Need",
          "price": 135,
          "url": "https://www.runnersneed.com"
        },
        {
          "store": "Amazon UK",
          "price": 125,
          "url": "https://www.amazon.co.uk"
        }
      ]
    },
    {
      "handle": "peak-approach-shoe",
      "category": "trainers",
      "title": "Scramble Approach Shoe",
      "description": "Sticky-rubber approach shoe for scrambles and hikes.",
      "price": 115,
      "cost": 60,
      "stock": 35,
      "emoji": "👟",
      "comparatorQuery": "approach shoe price UK",
      "mockCompetitors": [
        {
          "store": "Sports Direct",
          "price": 108,
          "url": "https://www.sportsdirect.com"
        },
        {
          "store": "Runners Need",
          "price": 122,
          "url": "https://www.runnersneed.com"
        },
        {
          "store": "Amazon UK",
          "price": 113,
          "url": "https://www.amazon.co.uk"
        }
      ]
    }
  ]
}$cfg$::jsonb, 1, 'seed')
on conflict (vendor_id) do nothing;

-- megamart
insert into public.vendor_config (vendor_id, vendor, catalog, version, updated_by)
values ('megamart', $cfg${
  "id": "megamart",
  "name": "MegaMart",
  "tagline": "Everything store, loss-leader prices",
  "logo": "🛒",
  "accent": "#16a34a",
  "port": 4108,
  "personality": "relentless generalist that will lose money on the headline item to win the customer",
  "deliveryDays": 6,
  "strategy": "10% margin across the board - we'll win on price. Standard delivery is slow. Perks only as a last resort. Clearance at 5%.",
  "minMarginPct": 10,
  "clearanceMarginPct": 5,
  "perksFirst": false,
  "codeTtlMinutes": 30,
  "scripted": {
    "openingDiscountPct": 6,
    "undercut": 4
  },
  "voice": {
    "opening": "£{price}{perks}. Why pay more?",
    "counter": "£{price}{perks}. {rival}'s pricing team is crying.",
    "hold": "Nobody beats MegaMart. Holding.",
    "withdraw": "Even MegaMart has a floor - {rival} can have this one."
  },
  "perks": [
    {
      "id": "priority",
      "label": "Priority delivery (3 days)",
      "costToMerchant": 6,
      "valueToBuyer": 5,
      "deliveryDays": 3
    },
    {
      "id": "gift-card",
      "label": "£10 MegaMart gift card",
      "costToMerchant": 10,
      "valueToBuyer": 10
    }
  ],
  "shopify": {
    "domainEnv": "MEGAMART_SHOPIFY_DOMAIN",
    "tokenEnv": "MEGAMART_SHOPIFY_TOKEN"
  }
}$cfg$::jsonb, $cfg${
  "products": [
    {
      "handle": "megamart-anc-headphones",
      "category": "headphones",
      "title": "MegaSound ANC Headphones",
      "description": "Over-ear ANC headphones, 35-hour battery.",
      "price": 229,
      "cost": 182,
      "stock": 900,
      "emoji": "🎧",
      "comparatorQuery": "own-brand ANC headphones price UK",
      "mockCompetitors": [
        {
          "store": "Currys",
          "price": 239,
          "url": "https://www.currys.co.uk"
        },
        {
          "store": "Amazon UK",
          "price": 229,
          "url": "https://www.amazon.co.uk"
        },
        {
          "store": "John Lewis",
          "price": 249,
          "url": "https://www.johnlewis.com"
        }
      ]
    },
    {
      "handle": "megamart-truebuds",
      "category": "earbuds",
      "title": "TrueBuds ANC",
      "description": "ANC earbuds with charging case.",
      "price": 115,
      "cost": 92,
      "stock": 1500,
      "emoji": "🎵",
      "comparatorQuery": "budget ANC earbuds price UK",
      "mockCompetitors": [
        {
          "store": "Currys",
          "price": 119,
          "url": "https://www.currys.co.uk"
        },
        {
          "store": "Amazon UK",
          "price": 115,
          "url": "https://www.amazon.co.uk"
        }
      ]
    },
    {
      "handle": "megamart-winter-parka",
      "category": "jacket",
      "title": "Winter Parka",
      "description": "Hooded winter parka with faux-fur trim.",
      "price": 135,
      "cost": 108,
      "stock": 400,
      "emoji": "🧥",
      "comparatorQuery": "winter parka price UK",
      "mockCompetitors": [
        {
          "store": "JD Sports",
          "price": 150,
          "url": "https://www.jdsports.co.uk"
        },
        {
          "store": "ASOS",
          "price": 135,
          "url": "https://www.asos.com"
        }
      ]
    },
    {
      "handle": "megamart-runner",
      "category": "trainers",
      "title": "Road Runner Trainers",
      "description": "Lightweight running trainers.",
      "price": 125,
      "cost": 100,
      "stock": 600,
      "emoji": "👟",
      "comparatorQuery": "running trainers price UK",
      "mockCompetitors": [
        {
          "store": "Sports Direct",
          "price": 120,
          "url": "https://www.sportsdirect.com"
        },
        {
          "store": "Runners Need",
          "price": 135,
          "url": "https://www.runnersneed.com"
        },
        {
          "store": "Amazon UK",
          "price": 125,
          "url": "https://www.amazon.co.uk"
        }
      ]
    },
    {
      "handle": "megamart-bean-to-cup",
      "category": "coffee-machine",
      "title": "Bean-to-Cup Coffee Machine",
      "description": "Bean-to-cup with milk frother.",
      "price": 479,
      "cost": 400,
      "stock": 80,
      "emoji": "☕",
      "comparatorQuery": "bean to cup coffee machine price UK",
      "mockCompetitors": [
        {
          "store": "Argos",
          "price": 499,
          "url": "https://www.argos.co.uk"
        },
        {
          "store": "John Lewis",
          "price": 529,
          "url": "https://www.johnlewis.com"
        },
        {
          "store": "Amazon UK",
          "price": 479,
          "url": "https://www.amazon.co.uk"
        }
      ]
    },
    {
      "handle": "megamart-laptop-15",
      "category": "laptop",
      "title": "Everyday Laptop 15",
      "description": "15.6-inch laptop, 16GB RAM, 512GB SSD.",
      "price": 849,
      "cost": 740,
      "stock": 120,
      "emoji": "💻",
      "comparatorQuery": "15 inch laptop price UK",
      "mockCompetitors": [
        {
          "store": "Currys",
          "price": 879,
          "url": "https://www.currys.co.uk"
        },
        {
          "store": "Amazon UK",
          "price": 849,
          "url": "https://www.amazon.co.uk"
        },
        {
          "store": "Box",
          "price": 899,
          "url": "https://www.box.co.uk"
        }
      ]
    }
  ]
}$cfg$::jsonb, 1, 'seed')
on conflict (vendor_id) do nothing;

-- History rows for anything just seeded
insert into public.vendor_config_history (vendor_id, version, vendor, catalog, updated_by)
select c.vendor_id, c.version, c.vendor, c.catalog, 'seed' from public.vendor_config c
where not exists (select 1 from public.vendor_config_history h where h.vendor_id = c.vendor_id);

select vendor_id, version, jsonb_array_length(catalog->'products') as products from public.vendor_config order by vendor_id;
