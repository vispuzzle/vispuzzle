import base64
import json
import os
import re
from io import BytesIO
import argparse
import cairosvg
import datetime
from openai import OpenAI
from PIL import Image

_CLIENT = None


def get_client():
    global _CLIENT
    if _CLIENT is None:
        api_key = os.getenv("VISPUZZLE_LLM_API_KEY") or os.getenv("OPENAI_API_KEY")
        base_url = os.getenv("VISPUZZLE_LLM_BASE_URL") or os.getenv("OPENAI_BASE_URL")
        kwargs = {}
        if api_key:
            kwargs["api_key"] = api_key
        if base_url:
            kwargs["base_url"] = base_url
        try:
            _CLIENT = OpenAI(**kwargs)
        except Exception as exc:
            raise RuntimeError(
                "Failed to initialize the scoring-model client. Set VISPUZZLE_LLM_API_KEY/OPENAI_API_KEY "
                "and optionally VISPUZZLE_LLM_BASE_URL/OPENAI_BASE_URL."
            ) from exc
    return _CLIENT

def resize_image(img, max_size=512):
    width, height = img.size
    ratio = min(max_size / width, max_size / height)
    if ratio >= 1:
        return img
    new_width = int(width * ratio)
    new_height = int(height * ratio)
    resized_img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
    return resized_img
    
def image_to_base64(image_path, target_size=512):
    if image_path.endswith('.svg'):
        with open(image_path, 'rb') as f:
            png_data = cairosvg.svg2png(bytestring=f.read())
        img = Image.open(BytesIO(png_data))
    else:
        img = Image.open(image_path)
    buffered = BytesIO()
    img.save(buffered, format="PNG")
    img_base64 = base64.b64encode(buffered.getvalue()).decode('utf-8')
    return img_base64

def ask(prompt, return_usage=False):
    token = 0
    number_of_trials = 0
    while number_of_trials < 5:
        try:
            response = get_client().chat.completions.create(
              model="gemini-2.0-flash",
              messages=[
                {
                  "role": "user",
                  "content": [
                    {   
                        "type": "text", 
                        "text": prompt},
                  ],
                }
              ]
            )
            token += response.usage.total_tokens
            content = response.choices[0].message.content
            if return_usage:
                return content, response.usage
            return content

        except Exception as e:
            number_of_trials += 1
            print(e)

    if return_usage:
        return 'Error!', None
    return 'Error!'

def ask_image(prompt, image_data, model='gemini-2.5-flash', return_usage=False):
    token = 0
    number_of_trials = 0
    while number_of_trials < 5:
        try:
            response = get_client().chat.completions.create(
              model=model,
              messages=[
                {
                  "role": "user",
                  "content": [
                    {   
                        "type": "text", 
                        "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{image_data}"
                        },
                    },
                  ],
                }
              ]
            )
            token += response.usage.total_tokens
            content = response.choices[0].message.content
            if return_usage:
                return content, response.usage
            return content

        except Exception as e:
            number_of_trials += 1
            print(e)

    return 'Error!'

def chat_with_image(prompts, image_data, model='gemini-2.0-flash'):
    token = 0
    number_of_trials = 0
    
    # 将所有评分维度合并成一个请求
    combined_prompt = "\n\n".join([f"Dimension {i+1}: {prompt}" for i, prompt in enumerate(prompts)])
    combined_prompt += "\n\nFor each dimension, provide a separate evaluation following the requested format. Number your responses as 'Dimension 1', 'Dimension 2', etc."
    
    while number_of_trials < 5:
        try:
            messages = [{
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": combined_prompt
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{image_data}"
                        }
                    }
                ]
            }]
            
            response = get_client().chat.completions.create(
                model=model,
                messages=messages
            )
            
            token += response.usage.total_tokens
            
            # 将响应拆分为每个维度的单独答案
            answer = response.choices[0].message.content
            dimension_pattern = r'Dimension (\d+):(.*?)(?=Dimension \d+:|$)'
            dimension_matches = re.findall(dimension_pattern, answer, re.DOTALL)
            
            # 如果没有正确按维度划分，尝试其他分割方式
            if not dimension_matches or len(dimension_matches) < len(prompts):
                # 尝试根据"Score:"作为分割点
                score_pattern = r'(Score: \d+.*?)(?=Score: \d+|$)'
                score_matches = re.findall(score_pattern, answer, re.DOTALL)
                
                if len(score_matches) == len(prompts):
                    return score_matches
                    
                # 如果仍然无法分割，返回整个答案作为第一个维度的评估
                print("Warning: Could not separate dimensions in response. Returning full response.")
                return [answer] + ['No valid response'] * (len(prompts) - 1)
            
            # 返回每个维度的内容
            return [match[1].strip() for match in dimension_matches]

        except Exception as e:
            number_of_trials += 1
            print(f"Error in chat_with_image: {e}")
            
    return ['Error!'] * len(prompts)

def get_aesthetic_score(image_path, model='gemini-2.5-flash'):
    """
    获取可视化的美学评分
    
    Args:
        image_path: 图像文件路径
        model: 使用的模型名称
        
    Returns:
        dict: 包含美学评分的字典，格式为 {"aesthetic_score": 分值, "details": 详细评价}
              分值范围为1-5
    """
    prompt = '''### ROLE ###
You are an expert in information design and data visualization aesthetics. Your task is to provide an objective aesthetic evaluation of a composite visualization's design quality.

### GOAL ###
The primary goal is to assess the design's aesthetic coherence and unity by evaluating its core visual elements.

### EVALUATION CRITERIA ###

- **Color Palette**: Is the color scheme harmonious, pleasing, and used consistently?
- **Typography**: Is there a consistent and limited set of fonts, sizes, and weights?
- **Element Styling**: Are styles for lines, points, bars, and other chart elements uniform throughout the visualization?

### TASK ###
Evaluate the aesthetic coherence of the provided composite visualization. Based on the Evaluation Criteria and the Scoring Rubric below, provide a precise score from 1 to 5 and a justification for your reasoning.

### SCORING RUBRIC ###

- **5 (Excellent / Unified)**: Demonstrates exceptional aesthetic coherence. The color palette, typography, and element styling work together seamlessly as a single, unified system, resulting in a polished and professional appearance.
- **4 (Good / Cohesive)**: Exhibits aesthetic coherence. The design is largely unified, but contains minor, non-critical inconsistencies in color, typography, or styling that detract slightly from a fully polished feel.
- **3 (Moderate / Inconsistent)**: Presents an inconsistent aesthetic. While some elements may be cohesive, there are notable and distracting inconsistencies across the color palette, typography, or element styling, disrupting the overall visual unity.
- **2 (Poor / Disconnected)**: Reveals significant aesthetic disharmony. The color, typography, and styling choices feel disconnected and randomly applied, creating a fragmented and unprofessional appearance that lacks clear visual logic.
- **1 (Unacceptable / Chaotic)**: Lacks any aesthetic coherence. The visualization is a chaotic and arbitrary mix of conflicting colors, fonts, and styles, resulting in a visually jarring and unprofessional presentation.

### REQUIRED OUTPUT FORMAT ###
Your response MUST strictly follow this format. Do not add any extra commentary outside of this structure.

Score: [A single integer from 1 to 5]
Explain: [A concise paragraph explaining your score, summarizing the design's performance against the evaluation criteria.]'''
    
    encode = image_to_base64(image_path)
    
    # 只发送一个维度的评估请求
    result = ask_image(prompt, encode, model)
    
    # 提取分数 - 现在期望1-5的分数
    score_match = re.search(r'Score:\s*([1-5])', result)
    if score_match:
        aesthetic_score = int(score_match.group(1))
        # 归一化到0-1范围
        normalized_score = aesthetic_score / 5.0
    else:
        print(f"Warning: Could not extract aesthetic score for {image_path}")
        aesthetic_score = 0
        normalized_score = 0.0
    
    # 返回结果
    return {
        "aesthetic_score": aesthetic_score,  # 直接返回0-5分数
        "normalized_score": normalized_score,  # 归一化的0-1分数
        "details": result
    }

def get_score(image_path, model='gemini-2.5-flash'):
    with open('./scoring_model/composite_prompt.json', 'r', encoding='utf-8') as f:
        summary_data = json.load(f)

    targets = ["View Coordination", "Space Layout", "Information Hierarchy", "Multi-Dimensional Insight", "Aesthetic Design"]

    prompt1 = '''Evaluation Dimension: {}
    
    This dimension means composite visualizations should meet these key criteria: {}
    Rate this dimension of the given composite visualization using a 5-point Likert scale:
    1. Highly poor: {}
    2. Poor: {}
    3. Moderate: {}
    4. Acceptable: {}
    5. Good: {}

    Give a score, name the issues and explain your answer. Answer in the following format:
    Score: 1 to 5
    Issues: a list of issues, if any
    Explain: why you gave the score you did
    '''
    encode = image_to_base64(image_path)
    prompts = []
    for target in targets:
        args = [target] + [summary_data[target]['requirements']] + summary_data[target]['likert']
        prompt = prompt1.format(*args)
        prompts.append(prompt)
    results = chat_with_image(prompts, encode, model)
    
    score = 0
    dimension_results = {}
    
    for i in range(len(targets)):
        if i >= len(results):
            print(f"Warning: Missing result for dimension {targets[i]}")
            dimension_results[targets[i]] = {
                "score": 0,
                "details": "No evaluation available"
            }
            continue
            
        target = targets[i]
        answer = results[i]
        
        # 提取分数
        score_match = re.search(r'Score:\s*(\d)', answer)
        if score_match:
            dimension_score = score_match.group(1)
            score += int(dimension_score)
            
            # 保存每个维度的评估结果
            dimension_results[target] = {
                "score": int(dimension_score),
                "details": answer
            }
        else:
            print(f"Warning: Could not extract score for dimension {target}")
            dimension_results[target] = {
                "score": 0,
                "details": answer
            }
    
    # 返回结果
    return {
        "score": score,
        "detailed_results": dimension_results
    }
    
if __name__ == '__main__':
    # eval('../../../comp-vis-renderer/data/output.svg')
    parser = argparse.ArgumentParser()
    parser.add_argument('--image_path', type=str, default='nobel.png')
    parser.add_argument('--model', type=str, default='o4-mini')
    args = parser.parse_args()
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    result_filename = os.path.basename(args.image_path).split('.')[0]
    os.makedirs('./output/single', exist_ok=True)
    
    # 获取评估结果
    result = get_score(args.image_path, args.model)
    result["image_path"] = args.image_path
    
    # 在主函数中保存结果
    with open(f'./output/single/{args.model}_{timestamp}.json', 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    
    print(f"\n\nScore for {args.image_path}: {result['score']}")
