import base64
from datetime import datetime
import json
import os
from openai import OpenAI
from search.LLMChart.utils_parse import safe_save_json, load_json

_CLIENT = None


def _build_client():
    api_key = os.getenv("VISPUZZLE_LLM_API_KEY") or os.getenv("OPENAI_API_KEY")
    base_url = os.getenv("VISPUZZLE_LLM_BASE_URL") or os.getenv("OPENAI_BASE_URL")
    kwargs = {}
    if api_key:
        kwargs["api_key"] = api_key
    if base_url:
        kwargs["base_url"] = base_url
    try:
        return OpenAI(**kwargs)
    except Exception as exc:
        raise RuntimeError(
            "Failed to initialize the LLM client. Set VISPUZZLE_LLM_API_KEY/OPENAI_API_KEY "
            "and optionally VISPUZZLE_LLM_BASE_URL/OPENAI_BASE_URL."
        ) from exc

def get_client():
    global _CLIENT
    if _CLIENT is None:
        _CLIENT = _build_client()
    return _CLIENT

def ask_question_with_image(client, image_path, question, model_type):
    # 读取图片并转换为base64
    with open(image_path, "rb") as image_file:
        base64_image = base64.b64encode(image_file.read()).decode('utf-8')

    chat_completion = client.chat.completions.create(
        model=model_type,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": question
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{base64_image}"
                        }
                    }
                ],
            }
        ],
        max_tokens=2000
    )
    # print(chat_completion)
    return chat_completion.choices[0].message.content

def ask_question_without_image(client, question, model_type):

    chat_completion = client.chat.completions.create(
        model=model_type,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": question
                    }
                ],
            }
        ],
        max_tokens=15000
    )

    return chat_completion.choices[0].message.content

def save_chat_result(save_path, question, result, image_name, model_type, version='0'):
    results = load_json(save_path)
    if image_name not in results:
        results[image_name] = []
    results[image_name].append({
        "model": model_type,
        "question": question,
        "prompt_version": version,
        "result": result,
        "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    })
    safe_save_json(results, save_path)
