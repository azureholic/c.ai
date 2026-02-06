"""
Profile Picture Generator
Generates AI profile pictures for users in the cupid matchmaking dataset.
"""

import pandas as pd
import os
from pathlib import Path
import time
import certifi
import requests
from dotenv import load_dotenv


# Fix SSL certificate path issue
os.environ['SSL_CERT_FILE'] = certifi.where()
os.environ['REQUESTS_CA_BUNDLE'] = certifi.where()

# Load environment variables from .env file
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

# Configuration
DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "cupid_matchmaking", "data", "dataset_cupid_matchmaking.csv")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "pictures")
IMAGE_SIZE = "1024x1024"

# Azure OpenAI Configuration
AZURE_OPENAI_ENDPOINT = os.getenv("AZURE_OPENAI_ENDPOINT")
AZURE_OPENAI_API_KEY = os.getenv("AZURE_OPENAI_API_KEY")

# Region to appearance mapping for culturally appropriate portraits
REGION_APPEARANCE = {
    "North Europe": "Scandinavian, Nordic features, fair skin, light hair",
    "West Europe": "Western European, French or German heritage",
    "UK South": "British, European features",
    "East US": "American, diverse appearance",
    "West US": "American, diverse appearance, casual West Coast style",
    "Australia East": "Australian, sun-kissed, outdoor lifestyle",
    "Brazil South": "Brazilian, Latin American, warm skin tones",
    "Japan East": "Japanese, East Asian features"
}


def create_prompt_from_profile(row):
    """Generate a portrait description based on user profile."""
    name = row['name']
    age = row['age']
    location_region = row['location_region']
    interests = row['interests'].replace(',', ', ')
    
    # Determine age category for better prompts
    if age < 25:
        age_desc = "young adult"
    elif age < 40:
        age_desc = "adult"
    elif age < 60:
        age_desc = "middle-aged"
    else:
        age_desc = "mature"
    
    # Get regional appearance description
    appearance = REGION_APPEARANCE.get(location_region, "diverse appearance")
    
    # Infer likely presentation from first name patterns
    first_name = name.split()[0]
    
    prompt = (
        f"Professional dating profile portrait photo of a {age_desc} person "
        f"named {first_name}, around age {age}, {appearance}, "
        f"friendly and approachable, casual style, "
        f"natural lighting, interests include {interests}, high quality headshot"
    )
    
    return prompt


def generate_profile_pictures():
    """Generate AI profile pictures for all users in the dataset."""
    
    # Validate configuration
    if not AZURE_OPENAI_ENDPOINT or not AZURE_OPENAI_API_KEY:
        print("Error: Missing Azure OpenAI configuration in .env file")
        return
    
    # Create output directory if it doesn't exist
    Path(OUTPUT_DIR).mkdir(parents=True, exist_ok=True)
    
    # Read the dataset
    print(f"Loading dataset from {DATA_PATH}...")
    df = pd.read_csv(DATA_PATH)
    print(f"Found {len(df)} users")
    
    generated_count = 0
    skipped_count = 0
    error_count = 0
    
    # Generate images for each user
    for idx, row in df.iterrows():
        user_id = row['user_id']
        name = row['name']
        output_path = os.path.join(OUTPUT_DIR, f"{user_id}.jpg")
        
        # Skip if image already exists
        if os.path.exists(output_path):
            print(f"[{idx+1}/{len(df)}] {user_id} ({name}): Image already exists, skipping...")
            skipped_count += 1
            continue
        
        try:
            # Generate prompt based on profile
            prompt = create_prompt_from_profile(row)
            print(f"[{idx+1}/{len(df)}] {user_id} ({name}): Generating image...")
            print(f"  Prompt: {prompt[:100]}...")
            
            # Generate image using Azure OpenAI DALL-E
            headers = {
                "Content-Type": "application/json",
                "api-key": AZURE_OPENAI_API_KEY
            }
            
            payload = {
                "prompt": prompt,
                "size": IMAGE_SIZE,
                "quality": "standard",
                "n": 1
            }
            
            response = requests.post(
                AZURE_OPENAI_ENDPOINT,
                headers=headers,
                json=payload
            )
            response.raise_for_status()
            
            result = response.json()
            image_url = result["data"][0]["url"]
            
            # Download and save the image
            image_data = requests.get(image_url).content
            
            with open(output_path, 'wb') as f:
                f.write(image_data)
            
            print(f"  Saved to {output_path}")
            generated_count += 1
            
            # Rate limiting - max 5 images per minute (15 seconds between requests)
            time.sleep(15)
            
        except Exception as e:
            print(f"  Error generating image for {user_id} ({name}): {e}")
            error_count += 1
            continue
    
    print("\n" + "=" * 50)
    print("Profile picture generation complete!")
    print(f"  Generated: {generated_count}")
    print(f"  Skipped:   {skipped_count}")
    print(f"  Errors:    {error_count}")
    print("=" * 50)


if __name__ == "__main__":
    generate_profile_pictures()
