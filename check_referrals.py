#!/usr/bin/env python3
"""
Selenium-based script to check Cursor referral codes
Handles JavaScript rendering which basic requests cannot
"""

import csv
import os
import time
from urllib.parse import urlparse, parse_qs

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.common.exceptions import TimeoutException, WebDriverException


# Constants
DOLLAR_AMOUNT = 50



def setup_driver():
    """Setup Chrome WebDriver with appropriate options"""
    chrome_options = Options()
    chrome_options.add_argument("--headless")
    
    try:
        return webdriver.Chrome(options=chrome_options)
    except Exception as e:
        print(f"Error setting up WebDriver: {e}")
        print("Make sure you have Chrome and ChromeDriver installed")
        print("You can install ChromeDriver using: brew install chromedriver")
        return None


def extract_code_from_url(url):
    """Extract the referral code from the URL"""
    parsed = urlparse(url)
    params = parse_qs(parsed.query)
    return params.get('code', [None])[0]


def get_page_text(driver):
    """Extract text content from the page"""
    try:
        body = driver.find_element(By.TAG_NAME, "body")
        return body.text.lower()
    except Exception:
        return driver.page_source.lower()


def is_valid_code(text):
    """Check if text indicates a valid (unclaimed) referral code"""
    has_credit = "credit" in text
    has_amount = f"${DOLLAR_AMOUNT}" in text
    
    return has_credit and has_amount


def is_invalid_code(text):
    """Check if text indicates an invalid (claimed) referral code"""
    invalid_phrases = [
        "invalid referral code",
        "this referral code is invalid",
    ]
    
    return any(phrase in text for phrase in invalid_phrases) or (
        "invalid" in text and "referral" in text and "code" in text
    )


def check_referral_status(url, driver):
    """
    Check referral status using Selenium
    Returns: 'valid', 'invalid', 'error', or 'unknown'
    """
    try:
        driver.get(url)
        time.sleep(3)
        
        page_text = get_page_text(driver)
        
        # Check for valid code indicators
        if is_valid_code(page_text):
            return 'valid'
        
        # Check for invalid code indicators
        if is_invalid_code(page_text):
            return 'invalid'
        
        # Check page title
        try:
            title = driver.title.lower()
            if "invalid" in title and "referral" in title:
                return 'invalid'
        except Exception:
            pass
        
        # Check specific page elements
        try:
            headings = driver.find_elements(
                By.CSS_SELECTOR, "h1, h2, h3, .message, .error, .success, .credit"
            )
            for heading in headings:
                text = heading.text.lower()
                if "invalid referral code" in text:
                    return 'invalid'
                if "credit" in text and ("$50" in text or "$20" in text):
                    return 'valid'
        except Exception:
            pass
        
        return 'unknown'
        
    except TimeoutException:
        print(f"Timeout loading {url}")
        return 'error'
    except WebDriverException as e:
        print(f"WebDriver error for {url}: {e}")
        return 'error'
    except Exception as e:
        print(f"Unexpected error for {url}: {e}")
        return 'error'


def load_referral_data(csv_file):
    """Load referral data from CSV file"""
    referral_data = []
    
    try:
        with open(csv_file, 'r', encoding='utf-8') as file:
            reader = csv.DictReader(file)
            for row in reader:
                if not row or not row.get('link'):
                    continue
                
                url = row['link'].strip()
                if not url or not url.startswith('http'):
                    continue
                
                code = extract_code_from_url(url)
                if not code:
                    print(f"Warning: Could not extract code from {url}")
                    continue
                
                name = row.get('name', 'Unknown').strip() or 'Unknown'
                referral_data.append({'url': url, 'name': name, 'code': code})
                
    except Exception as e:
        print(f"Error reading CSV file: {e}")
        return None
    
    return referral_data


def print_results(valid_codes, invalid_codes, error_codes, unknown_codes, total):
    """Print analysis results to console"""
    print("\n" + "=" * 60)
    print("ANALYSIS RESULTS")
    print("=" * 60)
    
    print("\n📊 SUMMARY:")
    print(f"   Valid (Unclaimed): {len(valid_codes)}")
    print(f"   Invalid (Claimed): {len(invalid_codes)}")
    print(f"   Errors: {len(error_codes)}")
    print(f"   Unknown: {len(unknown_codes)}")
    print(f"   Total: {total}")
    
    if valid_codes:
        print(f"\n✅ VALID/UNCLAIMED CODES ({len(valid_codes)}):")
        print("-" * 40)
        for data in valid_codes:
            print(f"   Code: {data['code']}")
            print(f"   URL:  {data['url']}\n")


def save_results(output_file, valid_codes, total):
    """Save results to file"""
    with open(output_file, 'w') as f:
        f.write("CURSOR REFERRAL CODE ANALYSIS RESULTS (SELENIUM)\n")
        f.write("=" * 50 + "\n\n")
        f.write(f"Total Codes Checked: {total}\n\n")
        
        if valid_codes:
            f.write("VALID/UNCLAIMED CODES:\n")
            f.write("-" * 30 + "\n")
            for data in valid_codes:
                f.write(f"Code: {data['code']}\n")
                f.write(f"URL: {data['url']}\n\n")


def run_validation(csv_file, output_file, driver):
    """Run full validation on all referral codes"""
    referral_data = load_referral_data(csv_file)
    if not referral_data:
        return
    
    print(f"Found {len(referral_data)} referral codes to check...")
    print("Starting analysis...\n")
    
    results = {
        'valid': [],
        'invalid': [],
        'error': [],
        'unknown': []
    }
    
    status_icons = {
        'valid': '✅ VALID',
        'invalid': '❌ Invalid/Claimed',
        'error': '⚠️  Error',
        'unknown': '❓ Unknown'
    }
    
    # Check each referral code
    for i, data in enumerate(referral_data, 1):
        code = data['code']
        print(f"Checking {i}/{len(referral_data)}: {code}", end=' ... ')
        
        status = check_referral_status(data['url'], driver)
        results[status].append({**data, 'status': status})
        
        print(status_icons.get(status, '❓ Unknown'))
        time.sleep(1)
    
    # Print and save results
    print_results(
        results['valid'],
        results['invalid'],
        results['error'],
        results['unknown'],
        len(referral_data)
    )
    
    save_results(output_file, results['valid'], len(referral_data))
    print(f"\n💾 Results saved to: {output_file}")


def main():
    """Main execution function"""
    print("=== CURSOR REFERRAL CODE CHECKER ===")
    
    project_root = os.path.dirname(os.path.abspath(__file__))
    csv_file = os.path.join(project_root, 'data', 'links.csv')
    output_file = os.path.join(project_root, 'data', 'referral_check_results.txt')
    
    driver = setup_driver()
    if not driver:
        return
    
    try:
        run_validation(csv_file, output_file, driver)
            
    except KeyboardInterrupt:
        print("\n\nOperation cancelled by user")
    except Exception as e:
        print(f"Error in main execution: {e}")
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
