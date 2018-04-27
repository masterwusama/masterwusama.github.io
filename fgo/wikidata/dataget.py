import urllib  
import urllib.request
from bs4 import BeautifulSoup  
#beautifulsoup方法，第三方库的方法，爬找网页   
## 下载网页  
def get_content(url):  
    ''''' 
    @url:需要下载的网址 
    下载网址 
    '''  
    html = urllib.request.urlopen(url)  
    content = html.read().decode('utf-8')#转码  
    html.close()#记得要将打开的网页关闭，否则会出现意想不到的问题  
    #print (content)  
    return content  
      
def get_image(info):  
    ''''' 
    利用Soup第三方库实现抓取 
    '''  
    #oup = BeautifulSoup(info,"lxml")#设置解析器为“lxml”  
    #all_image = soup.find('div', class_='img').find_all('img') 
    #all_image = soup.find_all('img',class_='lazy')
    x =[];
    for num in range(1,205):
        x.append("https://img.fgowiki.com/fgo/head/" + str(num).zfill(3) + ".jpg")
    print(x)  

    for image in range(1,205):  

        urllib.request.urlretrieve(x[image - 1],"C:\\Users\\\patchoulisan\\Desktop\\pythongetimage\\new\\%s.jpg"%(str(image).zfill(3)))  

      
url = "https://fgowiki.com/guide"   
info = get_content(url)    
#print (info)   
get_image(info) 