import os
import re
import json
import logging
from datetime import datetime
from typing import Dict, Any

from node2_map_engine.policy_retriever import embed_text

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger("seed_policies")

_PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
POLICIES_DIR = os.path.join(_PROJECT_ROOT, "data", "policies")
DB_PATH = os.path.join(_PROJECT_ROOT, "mock_db.json")

def slugify(text: str) -> str:
    """Creates a URL/ID safe slug from a string."""
    text = text.lower()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "_", text)
    return text.strip("_")

def parse_markdown_policy(filepath: str, domain: str) -> Dict[str, Dict[str, Any]]:
    """
    Parses a markdown policy file.
    Sections are identified by '## '.
    Returns a dict of parsed clause records keyed by clause_id.
    """
    logger.info(f"Parsing policy file: {filepath} (Domain: {domain})")
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    # Split by '## ' headings
    parts = re.split(r"^##\s+", content, flags=re.MULTILINE)
    
    # The first part is the title / introduction (ignore or keep as metadata)
    title_part = parts[0]
    sections = parts[1:]
    
    clauses = {}
    for section in sections:
        lines = section.strip().split("\n")
        heading = lines[0].strip()
        body_text = "\n".join(lines[1:]).strip()
        
        if not heading or not body_text:
            continue
            
        slug = slugify(heading)
        clause_id = f"SEED-{domain.upper()}-{slug}"
        
        logger.info(f"Generating embedding for section: '{heading}'...")
        vector = embed_text(body_text)
        if vector is None:
            logger.warning(f"Could not generate embedding for section '{heading}'. Will save without vector.")
            
        clauses[clause_id] = {
            "clause_id": clause_id,
            "circular_id": "SEED_POLICY",
            "circular_date": datetime.now().strftime("%Y-%m-%d"),
            "domain": domain.upper(),
            "section_title": heading,
            "raw_text": body_text,
            "created_at": datetime.utcnow().isoformat(),
            "source": "SEED",
            "embedding": vector
        }
        
    return clauses

def seed_database():
    """Main database seeding function."""
    if not os.path.exists(POLICIES_DIR):
        logger.error(f"Policies directory not found at: {POLICIES_DIR}")
        return

    # Load existing mock DB
    db = {"clauses": {}, "compliance_maps": [], "human_review_queue": []}
    if os.path.exists(DB_PATH):
        try:
            with open(DB_PATH, "r", encoding="utf-8") as f:
                db = json.load(f)
        except Exception as e:
            logger.warning(f"Could not load existing DB ({e}). Starting fresh.")

    # Scan policies directory for markdown files
    md_files = [f for f in os.listdir(POLICIES_DIR) if f.endswith(".md")]
    
    if not md_files:
        logger.error("No policy markdown files found to seed.")
        return

    logger.info(f"Found {len(md_files)} markdown policy files: {md_files}")
    
    all_clauses = db.setdefault("clauses", {})
    
    # Process each markdown file
    for filename in md_files:
        domain = os.path.splitext(filename)[0]
        # Map specific file names to standardised domains
        if domain == "cyber":
            domain = "CYBERSECURITY"
        
        filepath = os.path.join(POLICIES_DIR, filename)
        parsed_clauses = parse_markdown_policy(filepath, domain)
        
        for cid, record in parsed_clauses.items():
            all_clauses[cid] = record
            
    # Save the updated database
    with open(DB_PATH, "w", encoding="utf-8") as f:
        json.dump(db, f, indent=2)
        
    logger.info(f"Database seeding completed successfully! Seeded {len(all_clauses)} clauses into '{DB_PATH}'.")

if __name__ == "__main__":
    seed_database()
