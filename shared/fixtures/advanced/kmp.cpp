#include <iostream>
#include <string>
int main(){
 std::string text; std::string pattern;
 std::getline(std::cin,text); std::getline(std::cin,pattern);
 int n=text.size(); int m=pattern.size(); int prefix[30]={};
 int j=0;
 for(int i=1;i<m;i=i+1){
  while(j>0 && pattern[i]!=pattern[j]){j=prefix[j-1];}
  if(pattern[i]==pattern[j]){j=j+1;} prefix[i]=j;
 }
 int answer=-1;
 if(m==0){answer=0;}else{
  j=0;
  for(int i=0;i<n;i=i+1){
   while(j>0 && text[i]!=pattern[j]){j=prefix[j-1];}
   if(text[i]==pattern[j]){j=j+1;}
   if(j==m){answer=i-m+1;break;}
  }
 }
 std::cout<<answer;return 0;
}
