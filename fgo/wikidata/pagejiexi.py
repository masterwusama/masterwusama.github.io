import bs4
import requests
import json


for num in range(1,206):
        response = requests.get('https://fgowiki.com/guide/petdetail/' + str(num))
        soup = bs4.BeautifulSoup(response.text,"lxml")
        # links = soup.find_all('div', attrs={'class':['Databox','Databox-G']})

        # links = soup.select('table:nth-of-type(8) tr:nth-of-type(2) td:nth-of-type(1) img')
        links = soup.select('script')

        start = str(links).index("var datadetail =")
        end = str(links).index("//console.log(datadetail);")


        datadetail = str(links)[int(start) + 16:int(end) - 2]

        json_ob1 = json.loads(datadetail)
        

        # jsonobreal = json.dumps(contentt)
        json_ob1[0]["SKILL_E1"] = json_ob1[0]["SKILL_E1"].split('&')
        json_ob1[0]["SKILL_E2"] = json_ob1[0]["SKILL_E2"].split('&')
        json_ob1[0]["SKILL_E3"] = json_ob1[0]["SKILL_E3"].split('&')
        json_ob1[0]["Skill_Name_Arr"] = json_ob1[0]["Skill_Name_Arr"].split('|')
        json_ob1[0]["Skill_Img_Arr"] = json_ob1[0]["Skill_Img_Arr"].split('|')
        json_ob1[0]["Skill_Border_Arr"] = json_ob1[0]["Skill_Border_Arr"].split('|')
        json_ob1[0]["Skill_Number_Arr"] = json_ob1[0]["Skill_Number_Arr"].split('|')
        json_ob1[0]["Skill_QP_Arr"] = json_ob1[0]["Skill_QP_Arr"].split('|')
        json_ob1[0]["Berak_QP_Arr"] = json_ob1[0]["Berak_QP_Arr"].split('|')
        json_ob1[0]["T_EFFECT"] = json_ob1[0]["T_EFFECT"].split('+')
        
        
        

        json_ob1[0]["S1LV"] = json_ob1[0]["S1LV"].split('-')
        for num1 in range(len(json_ob1[0]["S1LV"])):
                tempj = json_ob1[0]["S1LV"][int(num1)]
                json_ob1[0]["S1LV"][int(num1)] = tempj.split('|');

        json_ob1[0]["S2LV"] = json_ob1[0]["S2LV"].split('-')
        for num2 in range(len(json_ob1[0]["S2LV"])):
                json_ob1[0]["S2LV"][int(num2)] = json_ob1[0]["S2LV"][int(num2)].split('|');

        json_ob1[0]["S3LV"] = json_ob1[0]["S3LV"].split('-')
        for num3 in range(len(json_ob1[0]["S3LV"])):
                json_ob1[0]["S3LV"][int(num3)] = json_ob1[0]["S3LV"][int(num3)].split('|');

        json_ob1[0]["T_Num_Arr"] = json_ob1[0]["T_Num_Arr"].split('-')
        for num4 in range(len(json_ob1[0]["T_Num_Arr"])):
                json_ob1[0]["T_Num_Arr"][int(num4)] = json_ob1[0]["T_Num_Arr"][int(num4)].split('|');

        json_ob1[0]["Break_Name_Arr"] = json_ob1[0]["Break_Name_Arr"].split('|')
        for num5 in range(len(json_ob1[0]["Break_Name_Arr"])):
                json_ob1[0]["Break_Name_Arr"][int(num5)] = json_ob1[0]["Break_Name_Arr"][int(num5)].split(',');

        json_ob1[0]["Break_Img_Arr"] = json_ob1[0]["Break_Img_Arr"].split('|')
        for num6 in range(len(json_ob1[0]["Break_Img_Arr"])):
                json_ob1[0]["Break_Img_Arr"][int(num6)] = json_ob1[0]["Break_Img_Arr"][int(num6)].split(',');

        json_ob1[0]["Break_Border_Arr"] = json_ob1[0]["Break_Border_Arr"].split('|')
        for num7 in range(len(json_ob1[0]["Break_Border_Arr"])):
                json_ob1[0]["Break_Border_Arr"][int(num7)] = json_ob1[0]["Break_Border_Arr"][int(num7)].split(',');

        json_ob1[0]["Break_Number_Arr"] = json_ob1[0]["Break_Number_Arr"].split('|')
        for num8 in range(len(json_ob1[0]["Break_Number_Arr"])):
                json_ob1[0]["Break_Number_Arr"][int(num8)] = json_ob1[0]["Break_Number_Arr"][int(num8)].split(',');


        contentt = str(json_ob1).replace('\"', '\'')
        contentt = contentt.replace('\'', '\"')

        filename = str(num).zfill(3) + '.json'
        with open(filename ,'w',encoding='utf-8') as f:
        	f.write(contentt)
