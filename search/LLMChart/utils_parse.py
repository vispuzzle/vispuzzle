import os
import json
import time
from selenium.webdriver.common.by import By
from tqdm import trange, tqdm
from bs4 import BeautifulSoup
import requests
import logging
from filelock import FileLock
from hashlib import sha256


def get_selenium_driver(show=False):
    from selenium import webdriver
    from selenium.webdriver import ChromeOptions
    cr_options = ChromeOptions()
    if show:
        cr_options.add_argument("--start-maximized")
    else:
        cr_options.add_argument("--window-size=2576,1408")
        # cr_options.add_argument("--window-size=1920,1080")
        cr_options.add_argument('--headless')
        cr_options.add_argument("--disable-extensions")
        cr_options.add_argument('--no-sandbox')
    # cr_options.page_load_strategy = 'none'
    _driver = webdriver.Chrome(options=cr_options, keep_alive=False)
    print('Size: ' + str(_driver.get_window_size()))
    return _driver

def get_logger(name, log_path):
    logger = logging.getLogger(name)
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s', \
        handlers=[logging.FileHandler(filename=log_path, encoding='utf-8', mode='a+'), logging.StreamHandler()])
    return logger

def load_txt(save_path):
    info = ''
    if os.path.exists(save_path):
        with open(save_path, "r", encoding='utf-8') as f:
            info = f.read()
    return info


def load_json(save_path):
    info_dict = {}
    if os.path.exists(save_path):
        with open(save_path, "r", encoding='utf-8') as f:
            info_dict = json.load(f)
    print('already have', len(info_dict))
    return info_dict


def safe_save_json(info_dict, save_path):
    # print('--------------------saving...')
    while True:
        try:
            with open(save_path, "w", encoding='utf-8') as f:
                json.dump(info_dict, f, indent=2, ensure_ascii=False)
            break
        except:
            print('----------do not interrupt saving, retrying...')
    print(f'--------------------save success,', len(info_dict), 'saved')


def sync_json(info_dict, save_path):
    print('--------------------syncing...')
    lock = FileLock(save_path + '.lock')
    with lock:
        origin_dict = load_json(save_path)
        for k in info_dict:
            if k not in origin_dict:
                origin_dict[k] = info_dict[k]
            elif k == 'error_links':
                origin_dict[k] = list(set(origin_dict[k] + info_dict[k]))
            elif 'query_kw' in info_dict[k] and 'query_kw' in origin_dict[k]:
                origin_dict[k]['query_kw'] = list(set(origin_dict[k]['query_kw'] + info_dict[k]['query_kw']))
        safe_save_json(origin_dict, save_path)
    return origin_dict


def get_id_from_url(url):
    return [i for i in url.split('/') if len(i)>0][-1]


def get_headers(proxy=False):
    if proxy:
        os.environ["http_proxy"] = "http://127.0.0.1:3213"
        os.environ["https_proxy"] = "http://127.0.0.1:3213"
    headers = {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    }
    return headers


def login_pinterest(_driver):
    with open("my_env.json", "r") as f:
        env_dict = json.load(f)['pinterest']
    _driver.get('https://www.pinterest.com/')
    time.sleep(5)
    # try login for better search results
    _driver.find_element(By.XPATH, '//div[@data-test-id="simple-login-button"]/button').click()
    time.sleep(20)
    _driver.find_element(By.XPATH, '//*[@id="email"]').send_keys(env_dict['email'])
    _driver.find_element(By.XPATH, '//*[@id="password"]').send_keys(env_dict['password'])
    _driver.find_element(By.XPATH, '//div[@data-test-id="registerFormSubmitButton"]/button').click()
    time.sleep(10)


def get_from_dom(dom, xpath, attr=None, return_list=False):
    if return_list:
        res = []
        for ele in dom.xpath(xpath):
            try:
                if attr is None:
                    res.append(''.join(ele.itertext()).strip())
                else:
                    res.append(ele.get(attr))
            except:
                pass
        return res
    try:
        if attr is None:
            return ''.join(dom.xpath(xpath)[0].itertext()).strip() # dom.xpath(xpath)[0].text
        else:
            if dom.xpath(xpath)[0].get(attr) is None:
                return ''
            return dom.xpath(xpath)[0].get(attr)
    except:
        # print(xpath, 'not found')
        return ''


def get_from_ele(ele, xpath, attr=None):
    try:
        if attr is None:
            return ele.find_element(By.XPATH, xpath).text
        else:
            return ele.find_element(By.XPATH, xpath).get_attribute(attr)
    except:
        return ''


def get_dom_from_url(base_url, headers):
    while True:
        try:
            response = requests.get(base_url, headers=headers)
            break
        except KeyboardInterrupt:
            raise
        except:
            print('-----Network error, wait 10s and retry--', base_url)
            time.sleep(10)
    time.sleep(0.1)
    # with open('test.html', 'w', encoding='utf-8') as f:
    #     f.write(response.content.decode('utf-8'))
    
    # 玄学bug... 有时候会解析不出来，不知道为什么
    soup = BeautifulSoup(response.text, 'html.parser')
    dom = etree.HTML(str(soup))
    # dom = etree.HTML(response.content)
    # close response
    response.close()
    del(response)
    return dom

def gen_hash(s):
    return sha256(s.encode('utf-8')).hexdigest()

