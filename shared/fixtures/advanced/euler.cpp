#include <iostream>
int main(){int n;std::cin>>n;int composite[31]={};int primes[30]={};int count=0;for(int i=2;i<=n;i=i+1){if(composite[i]==0){primes[count]=i;count=count+1;}for(int j=0;j<count && i*primes[j]<=n;j=j+1){composite[i*primes[j]]=1;if(i%primes[j]==0){break;}}}for(int i=0;i<count;i=i+1){std::cout<<primes[i]<<" ";}return 0;}
