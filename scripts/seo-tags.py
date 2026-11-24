#!/usr/bin/env python3
"""SEO head tags for solaire-intelligence.co.za.

Idempotent: everything this script adds sits between the SEO:BEGIN / SEO:END
markers in each page's <head>, and re-running replaces that block. Run from the
repo root:  python3 scripts/seo-tags.py
"""
import json, re, pathlib

SITE = "https://solaire-intelligence.co.za"
OG_DEFAULT = SITE + "/assets/products/si-gateway-device-v2.png"

# slug -> page settings. Pages not listed (admin, cart, thank-you, portal) are left alone.
PAGES = {
    "index": {"path": "/", "image": OG_DEFAULT, "org": True},
    "si-gateway": {"path": "/si-gateway", "image": SITE + "/assets/products/si-gateway-device-v2.png",
                   "product": {"name": "SI Gateway", "price": "1850",
                               "description": "Local RS485 gateway for Sunsynk and Deye hybrid inverters. Reads the inverter every 5 seconds, works without the cloud, appears in Home Assistant as a native ESPHome device and drives ECM load control. No subscription.",
                               "free_delivery": True}},
    "si-switch": {"path": "/si-switch", "image": SITE + "/assets/products/si-relay-enclosed.png",
                  "product": {"name": "SI Switch", "price": "1350",
                              "description": "Solar-aware relay that runs a pool pump, geyser, heat pump or other load when the SI Gateway's ECM score says there is solar to spare."}},
    "si-pool": {"path": "/si-pool", "image": SITE + "/assets/products/si-relay-assembled.png",
                "product": {"name": "SI Pool", "price": "7200",
                            "description": "Local pool automation with pump-current sensing, dry-run protection, scheduling and solar-aware pump control."}},
    "si-water": {"path": "/si-water", "image": SITE + "/assets/products/si-relay-assembled.png",
                 "product": {"name": "SI Water Kit", "price": "7899",
                             "description": "Tank and borehole automation: daily top-ups, emergency fills, borehole protection and municipal backup, running locally with no subscription."}},
    "ecm": {"path": "/ecm", "image": OG_DEFAULT},
    "learn": {"path": "/learn", "image": OG_DEFAULT},
    "docs": {"path": "/docs", "image": OG_DEFAULT},
    "privacy": {"path": "/privacy", "image": OG_DEFAULT},
    "sunsynk-wifi-dongle-alternative": {"path": "/sunsynk-wifi-dongle-alternative",
                                        "image": SITE + "/assets/products/si-gateway-device-v2.png",
                                        "faq_from_page": True},
}

def attr(s):
    return s.replace("&", "&amp;").replace('"', "&quot;")

def text(s):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s)).strip()

def build_block(slug, cfg, html):
    title = re.search(r"<title>(.*?)</title>", html, re.S)
    title = text(title.group(1)) if title else "Solaire Intelligence"
    desc = re.search(r'<meta name="description" content="(.*?)"', html, re.S)
    desc = desc.group(1) if desc else ""
    url = SITE + cfg["path"]
    have = lambda prop: re.search(r'property="%s"' % re.escape(prop), html.split("<!-- SEO:BEGIN")[0]) is not None

    lines = ['<!-- SEO:BEGIN (scripts/seo-tags.py) -->',
             f'  <link rel="canonical" href="{url}" />']
    og = {"og:type": "product" if "product" in cfg else "website",
          "og:site_name": "Solaire Intelligence", "og:locale": "en_ZA",
          "og:title": title, "og:description": desc, "og:url": url, "og:image": cfg["image"]}
    for k, v in og.items():
        if v and not have(k):
            lines.append(f'  <meta property="{k}" content="{attr(v)}" />')
    lines.append('  <meta name="twitter:card" content="summary_large_image" />')

    ld = []
    if cfg.get("org"):
        ld.append({"@context": "https://schema.org", "@type": "Organization",
                   "name": "Solaire Intelligence", "url": SITE + "/",
                   "logo": SITE + "/assets/si-logo.png", "email": "sales@solairesa.co.za",
                   "telephone": "+27738948248",
                   "address": {"@type": "PostalAddress", "addressCountry": "ZA"},
                   "sameAs": ["https://github.com/solaire-intelligence"]})
    p = cfg.get("product")
    if p:
        offer = {"@type": "Offer", "url": url, "priceCurrency": "ZAR", "price": p["price"],
                 "availability": "https://schema.org/InStock", "itemCondition": "https://schema.org/NewCondition",
                 "seller": {"@type": "Organization", "name": "Solaire Intelligence"}}
        if p.get("free_delivery"):
            offer["shippingDetails"] = {"@type": "OfferShippingDetails",
                                        "shippingRate": {"@type": "MonetaryAmount", "value": "0", "currency": "ZAR"},
                                        "shippingDestination": {"@type": "DefinedRegion", "addressCountry": "ZA"}}
        ld.append({"@context": "https://schema.org", "@type": "Product", "name": p["name"],
                   "description": p["description"], "image": cfg["image"],
                   "brand": {"@type": "Brand", "name": "Solaire Intelligence"}, "offers": offer})
    if cfg.get("faq_from_page"):
        qa = re.findall(r'<div class="card"[^>]*><h3[^>]*>(.*?)</h3><p[^>]*>(.*?)</p></div>', html, re.S)
        if qa:
            ld.append({"@context": "https://schema.org", "@type": "FAQPage",
                       "mainEntity": [{"@type": "Question", "name": text(q),
                                       "acceptedAnswer": {"@type": "Answer", "text": text(a)}} for q, a in qa]})
    for obj in ld:
        lines.append('  <script type="application/ld+json">' + json.dumps(obj, ensure_ascii=False) + '</script>')
    lines.append('<!-- SEO:END -->')
    return "\n".join(lines)

def main():
    root = pathlib.Path(__file__).resolve().parent.parent
    for slug, cfg in PAGES.items():
        f = root / f"{slug}.html"
        if not f.exists():
            print("skip (missing)", f.name); continue
        html = f.read_text(encoding="utf-8")
        html = re.sub(r"\n[ \t]*<!-- SEO:BEGIN.*?<!-- SEO:END -->(?:\n[ \t]*(?=\n))*", "", html, flags=re.S)
        block = build_block(slug, cfg, html)
        anchor = re.search(r'<meta name="description"[^>]*>', html) or re.search(r"</title>", html)
        html = html[:anchor.end()] + "\n  " + block + html[anchor.end():]
        f.write_text(html, encoding="utf-8")
        print("ok", f.name)

if __name__ == "__main__":
    main()
