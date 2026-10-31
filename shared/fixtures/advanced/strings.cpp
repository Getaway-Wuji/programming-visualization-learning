#include <iostream>
#include <string>
int main(){std::string s;std::string t;std::getline(std::cin,s);t=s;std::getline(std::cin,s);std::cout<<t<<s<<t.size();if(t.size()>0){std::cout<<t[0];}return 0;}
