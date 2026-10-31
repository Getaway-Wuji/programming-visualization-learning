#include <iostream>
int main(){int n;std::cin>>n;int composite[31]={};for(int i=2;i*i<=n;i=i+1){if(composite[i]==0){for(int j=i*i;j<=n;j=j+i){composite[j]=1;}}}for(int i=2;i<=n;i=i+1){if(composite[i]==0){std::cout<<i<<" ";}}return 0;}
